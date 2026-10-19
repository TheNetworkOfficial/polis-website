const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");
const previousPath = process.env.POLIS_PREVIOUS_SHARED_FEED_JS;
test("a previously loaded client keeps its held receipt while a new client enters guided setup", async ({
  browser,
}) => {
  test.skip(
    !previousPath,
    "Release compatibility requires the captured incumbent bundle.",
  );
  const previous = fs.readFileSync(previousPath);
  expect(crypto.createHash("sha256").update(previous).digest("hex")).toBe(
    "adf81333395847f60afdeb3e778cf2dfba0dc703d689369fa1a47d5167e92dac",
  );
  const oldContext = await browser.newContext(),
    newContext = await browser.newContext();
  try {
    const oldPage = await oldContext.newPage(),
      next = await newContext.newPage();
    await mockBook(oldPage);
    await oldPage.route("**/scripts/shared-feed.js*", (route) =>
      route.fulfill({ contentType: "text/javascript", body: previous }),
    );
    const writes = [];
    await oldPage.route(`**${PROMPT}/**`, (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname.slice(PROMPT.length);
      if (request.method() !== "GET") writes.push(path);
      const answer = (body) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, ...body }),
        });
      if (path === "/workspace")
        return answer({
          workspace: {
            provider: "prompt",
            scopeKey: "coalition:org-1",
            manualOnly: true,
            status: "configured",
            canSend: true,
            capabilities: { manualQueue: true },
          },
        });
      if (path === "/billing/summary")
        return answer({
          billing: { canManageBilling: false, sendingBlocked: false },
        });
      if (path === "/campaigns/held-campaign")
        return answer({
          campaign: {
            campaignId: "held-campaign",
            name: "Existing campaign",
            status: "active",
            canFetchQueue: true,
          },
        });
      if (path === "/campaigns/held-campaign/queue")
        return answer({
          state: "held",
          items: [
            {
              itemId: "same-item",
              state: "awaiting_confirmation",
              expiresAtMs: Date.now() + 60000,
              humanConfirmation: { recordId: "same-existing-receipt" },
              preview: {
                contactDisplayName: "Example recipient",
                contactPhone: "+12025550124",
                message: "Existing reviewed message. Reply STOP.",
              },
            },
          ],
        });
      return answer({ items: [] });
    });
    await oldPage.goto(
      `${BASE}/organizations/org-1/texting/send/held-campaign`,
    );
    await oldPage
      .getByRole("button", { name: "Get next recipients", exact: true })
      .click();
    await expect(
      oldPage.getByRole("button", {
        name: "Send to Example recipient",
        exact: true,
      }),
    ).toBeEnabled();
    const before = [...writes];
    await mockBook(next);
    const setup =
      "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod/api/texting/setup/coalition/org-1";
    await next.route("**/texting-setup-config.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
          enabled: true,
          apiBaseUrl:
            "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
        }),
      }),
    );
    await next.route(`${setup}**`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          setupAvailability: {
            state: "enabled",
            supportedWorkflowTypes: ["contact_book_single"],
          },
          capabilities: {
            isolatedSetup: true,
            createSetup: true,
            manageBilling: true,
          },
          setups: [],
          availableAudiences: [],
          volunteers: [],
        }),
      }),
    );
    await next.goto(`${BASE}/organizations/org-1/texting/campaigns`);
    await next
      .getByRole("button", { name: "New campaign", exact: true })
      .click();
    await expect(next).toHaveURL(/texting\/setup\/new$/);
    await expect(
      oldPage.getByText("Existing reviewed message. Reply STOP.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      oldPage.getByRole("button", {
        name: "Send to Example recipient",
        exact: true,
      }),
    ).toBeEnabled();
    expect(writes).toEqual(before);
    expect(writes.some((path) => /confirm|reply|release/.test(path))).toBe(
      false,
    );
  } finally {
    await oldContext.close();
    await newContext.close();
  }
});
