const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK } = require("./contact-book-fixture.cjs");

test("manager without spending permission can cancel another actor's job without advancing it", async ({
  page,
}, testInfo) => {
  const { errors } = await mockBook(page);
  const calls = [];
  let job = {
    id: "managed",
    status: "queued",
    addresses: 3,
    completed: 0,
    charged: 0,
    review: 0,
    canAdvance: false,
  };
  await page.route(
    "**/api/contact-book/scopes/**/geocoding/credits**",
    async (route) => {
      const path = new URL(route.request().url()).pathname.slice(
        `${BOOK}/geocoding/credits`.length,
      );
      calls.push({ path, method: route.request().method() });
      let value = {};
      if (!path)
        value = {
          enabled: true,
          spendingEnabled: false,
          available: 0,
          rights: { accepted: true },
          permissions: {
            manage: true,
            spend: false,
            purchase: false,
            sign: false,
          },
          included: {},
          purchased: {},
          settings: { revision: 1, automatic: {}, field: {} },
        };
      else if (path === "/jobs") value = { items: [job] };
      else if (path === "/jobs/managed") value = { job };
      else if (path === "/jobs/managed/cancel") {
        expect(route.request().method()).toBe("POST");
        job = { ...job, status: "cancelled" };
        value = { job };
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...value }),
      });
    },
  );
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("button", { name: "Geocode credits", exact: true })
    .click();
  await page.getByRole("button", { name: "Open job", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh processing", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cancel remaining addresses", exact: true })
    .click();
  await expect(
    page.getByText(/0 of 3 addresses complete.*cancelled/),
  ).toBeVisible();
  expect(calls.filter((row) => row.path.endsWith("/cancel"))).toHaveLength(1);
  expect(calls.filter((row) => row.path.endsWith("/advance"))).toHaveLength(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("manager-cancelled-without-advance.png"),
    fullPage: true,
  });
});

test("geocode review is free; explicit confirmation starts one scoped job and preserves selection", async ({
  page,
}) => {
  const { errors } = await mockBook(page);
  const calls = [];
  const job = {
    id: "job",
    addresses: 1,
    completed: 0,
    charged: 0,
    review: 0,
    status: "queued",
  };
  await page.route(
    "**/api/contact-book/scopes/**/geocoding/credits**",
    async (route) => {
      const path = new URL(route.request().url()).pathname.slice(
        `${BOOK}/geocoding/credits`.length,
      );
      const body = route.request().postDataJSON();
      calls.push({ path, body, method: route.request().method() });
      let value;
      if (!path)
        value = {
          enabled: true,
          available: 10,
          resetAt: new Date(Date.now() + 3600000).toISOString(),
          included: { available: 10, reserved: 0, used: 0 },
          purchased: { available: 0, reserved: 0 },
          rights: { accepted: true },
          permissions: { spend: true, manage: true, purchase: false },
          settings: {
            revision: 1,
            automatic: {
              enabled: false,
              usePurchased: false,
              purchasedDailyCap: 0,
            },
            field: {
              enabled: false,
              usePurchased: false,
              purchasedDailyCap: 0,
            },
          },
        };
      else if (path === "/quotes")
        value = {
          quote: {
            quoteId: "quote",
            selectedContacts: 1,
            contactsNeedingGeocodes: 1,
            uniqueAddresses: 1,
            cachedAddresses: 0,
            externalAddresses: 1,
            acquiredAddresses: 0,
            maximumCredits: 2,
            review: 0,
            providerReady: true,
            expiresAt: Date.now() + 600000,
          },
        };
      else if (path === "/executions") value = { job };
      else if (path.endsWith("/advance"))
        value = {
          job: { ...job, status: "complete", completed: 1, charged: 2 },
        };
      else if (path === "/settings") value = { settings: body };
      else value = {};
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...value }),
      });
    },
  );
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Geocode credits", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Geocode credits" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review selected addresses" }).click();
  await expect(
    page.getByText(/1 of 1 selected contacts need geocodes/),
  ).toBeVisible();
  expect(calls.filter((call) => call.path === "/executions")).toHaveLength(0);
  await page.getByRole("button", { name: "Spend up to 2 credits" }).click();
  await expect(page.getByText(/1 of 1 addresses complete/)).toBeVisible();
  expect(calls.filter((call) => call.path === "/executions")).toHaveLength(1);
  expect(
    calls.find((call) => call.path === "/executions").body.maximumCredits,
  ).toBe(2);
  await expect(
    page.getByRole("checkbox", { name: "Select Alex Example", exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"]) {
  test(`${theme}: stale selection cancels quote and settings refresh preserves draft`, async ({
    page,
  }) => {
    const { errors } = await mockBook(page);
    await page.emulateMedia({ colorScheme: theme });
    let revision = 1;
    const requests = [];
    await page.route(
      "**/api/contact-book/scopes/**/geocoding/credits**",
      async (route) => {
        const path = new URL(route.request().url()).pathname.slice(
          `${BOOK}/geocoding/credits`.length,
        );
        const body = route.request().postDataJSON();
        requests.push({ path, body });
        const value = !path
          ? {
              enabled: true,
              available: 5,
              rights: { accepted: true },
              included: { available: 5 },
              purchased: {},
              permissions: { spend: true, manage: true },
              settings: {
                revision,
                automatic: {
                  enabled: false,
                  usePurchased: false,
                  purchasedDailyCap: 0,
                },
                field: {},
              },
            }
          : path === "/quotes"
            ? {
                quote: {
                  status: "ready",
                  quoteId: "q",
                  selectedContacts: 1,
                  contactsNeedingGeocodes: 1,
                  uniqueAddresses: 1,
                  cachedAddresses: 1,
                  externalAddresses: 0,
                  acquiredAddresses: 0,
                  maximumCredits: 1,
                  review: 0,
                  expiresAt: Date.now() + 60000,
                },
              }
            : { items: [] };
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, ...value }),
        });
      },
    );
    await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
    await page
      .getByRole("checkbox", { name: "Select Alex Example", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Geocode credits", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review selected addresses" })
      .click();
    await expect(
      page.getByRole("button", { name: "Spend up to 1 credits" }),
    ).toBeVisible();
    expect(
      requests.find((r) => r.path === "/quotes").body.selectionId,
    ).toBeTruthy();
    await page
      .getByRole("checkbox", { name: "Select Alex Example", exact: true })
      .uncheck();
    await expect(
      page.getByRole("button", { name: "Spend up to 1 credits" }),
    ).toHaveCount(0);
    await page
      .getByRole("checkbox", {
        name: "Enable automatic geocoding",
        exact: true,
      })
      .check();
    revision = 2;
    await page
      .getByRole("button", { name: "Refresh balance", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", {
        name: "Enable automatic geocoding",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      page.getByText("Settings changed elsewhere.", { exact: false }),
    ).toBeVisible();
    expect(requests.filter((r) => r.path === "/executions")).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test("member cannot sign, manage automation or purchase and can page job outcomes", async ({
  page,
}) => {
  const { errors } = await mockBook(page);
  const paths = [];
  await page.route(
    "**/api/contact-book/scopes/**/geocoding/credits**",
    async (route) => {
      const path = new URL(route.request().url()).pathname.slice(
        `${BOOK}/geocoding/credits`.length,
      );
      paths.push(path);
      const value = !path
        ? {
            enabled: true,
            available: 0,
            included: {},
            purchased: {},
            rights: { accepted: true },
            permissions: { spend: false },
            settings: {},
          }
        : path === "/jobs"
          ? { items: [{ id: "old", status: "complete", addresses: 2 }] }
          : path === "/jobs/old"
            ? {
                job: {
                  id: "old",
                  status: "complete",
                  completed: 2,
                  addresses: 2,
                  charged: 2,
                  review: 0,
                },
              }
            : path.endsWith("/outcomes")
              ? {
                  items: [
                    {
                      contactId: "c",
                      displayName: "Fixture address",
                      status: "saved",
                      credits: 1,
                    },
                  ],
                  nextCursor: new URL(route.request().url()).search
                    ? null
                    : "next",
                }
              : {};
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...value }),
      });
    },
  );
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("button", { name: "Geocode credits", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review selected addresses" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save geocoding settings" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue to secure checkout" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open job", exact: true }).click();
  await page
    .getByRole("button", { name: "Review address results", exact: true })
    .click();
  await expect(
    page.getByText("Fixture address · saved · 1 credits"),
  ).toBeVisible();
  await page.getByRole("button", { name: "More results", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "More results", exact: true }),
  ).toHaveCount(0);
  expect(paths.filter((p) => p.endsWith("/outcomes"))).toHaveLength(2);
  expect(errors).toEqual([]);
});
