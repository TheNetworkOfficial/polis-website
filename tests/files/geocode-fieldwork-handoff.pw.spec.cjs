const { test, expect } = require("@playwright/test");
const { mockBook } = require("./contact-book-fixture.cjs");
const {
  BASE_URL,
  COALITION_PATH,
  mockFieldworkWorkspace,
} = require("./fixtures/fieldwork-workspace.cjs");

test("Ballot Chaser passes only the refreshed frozen selection into the current coalition wizard", async ({
  page,
}, testInfo) => {
  const field = await mockFieldworkWorkspace(page);
  const book = "/api/contact-book/scopes/coalition%3Acedar-valley";
  await mockBook(page, {
    scopeId: "cedar-valley",
    embedded: true,
    capabilities: { ballotChaser: true },
    queryResponse: async (_, fixture) => ({
      items: fixture.rows,
      complete: true,
      total: 3,
      bookRevision: 7,
    }),
  });
  const requests = [];
  let metadataRequest;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/territory-builder"))
      metadataRequest = Object.fromEntries(
        ["contactSelectionId", "electionId", "ballotSnapshotId"].map((key) => [
          key,
          url.searchParams.get(key),
        ]),
      );
  });
  const reply = (route, value) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...value }),
    });
  await page.route("**/ballot-chaser/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const election = {
      electionId: "fixture-election",
      name: "Fixture general election",
      electionDate: "2026-11-03",
      state: "MT",
      county: "Cascade",
      revision: 1,
      activeSnapshotId: "ballot-snapshot",
    };
    return reply(
      route,
      path.endsWith("/elections")
        ? { items: [election] }
        : path.endsWith("/dashboard")
          ? {
              dashboard: {
                snapshotId: "ballot-snapshot",
                sourceAsOf: "2026-10-26T10:00:00Z",
                coverage: "complete",
                total: 3,
                outstanding: 3,
                returned: 0,
                statusCounts: { issued: 3 },
              },
            }
          : path.endsWith("/fixture-election")
            ? { election }
            : { items: [] },
    );
  });
  await page.route("**/geocoding/credits**", (route) => {
    const path = new URL(route.request().url()).pathname.slice(
      `${book}/geocoding/credits`.length,
    );
    const body = route.request().postData()
      ? route.request().postDataJSON()
      : null;
    requests.push({ path, body, method: route.request().method() });
    if (!path)
      return reply(route, {
        enabled: true,
        available: 3,
        rights: { accepted: true },
        permissions: { spend: true },
        included: { available: 3 },
        purchased: {},
        settings: {},
      });
    if (path === "/quotes")
      return reply(route, {
        quote: {
          quoteId: "quote-frozen",
          status: "ready",
          selectionId: body.selectionId,
          destination: body.destination,
          selectedContacts: 3,
          contactsNeedingGeocodes: 0,
          uniqueAddresses: 0,
          cachedAddresses: 0,
          externalAddresses: 0,
          acquiredAddresses: 3,
          maximumCredits: 0,
          review: 0,
          providerReady: true,
          expiresAt: Date.now() + 60000,
        },
      });
    if (path === "/destinations")
      return reply(route, {
        destination: {
          id: "ready-destination",
          status: "ready",
          selectionId: body.selectionId,
          refreshedSelectionId: "selection-refreshed",
          eligibleContacts: 3,
          excludedContacts: 0,
          continuation: {
            operationId: "continue-once",
            selectionId: "selection-refreshed",
          },
        },
      });
    return reply(route, { items: [] });
  });
  await page.route(`**${book}/selections/selection-refreshed`, (route) =>
    reply(route, {
      selection: {
        selectionId: "selection-refreshed",
        status: "ready",
        count: 3,
        eligibleCount: 3,
        excludedCount: 0,
        bookRevision: 8,
      },
    }),
  );
  await page.route(`**${book}/household-map`, (route) =>
    reply(route, { markers: [], complete: true }),
  );
  await page.goto(
    `${BASE_URL}/workspace/coalition/cedar-valley/work/ballot-chaser`,
  );
  await page
    .getByRole("button", { name: "Show ballots not returned", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Build DoorKnocker territories", exact: true })
    .click();
  await expect(
    page.getByText(/0 of 3 selected contacts need geocodes/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check destination readiness", exact: true })
    .click();
  await expect(page).toHaveURL(
    `${BASE_URL}${COALITION_PATH}/voter-map/territories/admin`,
  );
  const dialog = page.locator(".polis-field-work dialog[open]");
  await expect(
    dialog.getByRole("heading", { name: "New territory", exact: true }),
  ).toBeVisible();
  const metadata = field.requests.filter((row) =>
    row.path.endsWith("/territory-builder"),
  );
  expect(metadata.length).toBeGreaterThan(0);
  // Inspect the actual browser request, since the fixture's concise request log omits queries.
  expect(metadataRequest).toEqual({
    contactSelectionId: "selection-refreshed",
    electionId: "fixture-election",
    ballotSnapshotId: "ballot-snapshot",
  });
  await dialog
    .getByRole("textbox", { name: "Plan name", exact: true })
    .fill("Frozen reviewed list");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Generate territories", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Review plan", exact: true })
    .click();
  await expect(dialog.locator("[data-fwb-assignee]")).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "Publish territories", exact: true }),
  ).toBeDisabled();
  for (const select of await dialog.locator("[data-fwb-assignee]").all())
    await select.selectOption("alex");
  await dialog
    .getByRole("button", { name: "Publish territories", exact: true })
    .click();
  await expect(
    page
      .locator(".polis-field-work")
      .getByRole("tab", { name: /^Territories/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Territories published.", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".polis-field-work")
    .getByRole("tab", { name: "Map", exact: true })
    .click();
  await page
    .locator(".polis-field-work")
    .getByRole("tab", { name: /^Territories/ })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    field.requests.filter((row) => row.path.endsWith("/territory-builder")),
  ).toHaveLength(1);
  const payloads = field.writes.filter((row) =>
    /\/territory-builder\/(preview|publish)$/.test(row.path),
  );
  expect(payloads.length).toBeGreaterThanOrEqual(3);
  for (const row of payloads) {
    expect(row.body.contactSelectionId).toBe("selection-refreshed");
    expect(row.body.ballotChase).toEqual(
      expect.objectContaining({
        electionId: "fixture-election",
        snapshotId: "ballot-snapshot",
      }),
    );
  }
  expect(requests.filter((row) => row.path === "/executions")).toHaveLength(0);
  expect(
    requests.find((row) => row.path === "/destinations").body.selectionId,
  ).toBe("selection-1");
  expect(field.errors).toEqual([]);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("frozen-selection-published.png"),
    fullPage: true,
  });
});
