const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");

const queryCalls = (fixture) =>
  fixture.calls.filter((call) => call.path === `${BOOK}/query`);
const lastQuery = (fixture) => queryCalls(fixture).at(-1)?.body;
const flatten = (filter) =>
  filter?.conditions
    ? filter.conditions.flatMap(flatten)
    : filter
      ? [filter]
      : [];
const pageIdentity = (body) => ({
  bookRevision: 7,
  indexGeneration: 1,
  schemaRevision: "redesign-schema",
  accessFingerprint: "redesign-reader",
  queryHash: JSON.stringify([body.filter, body.search, body.sort]),
  publication: { status: "ready", pending: 0 },
});

async function openContacts(page) {
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(
    page.getByRole("heading", { name: "Contact book", exact: true }),
  ).toBeVisible();
}

test("rows default to 50 and changing 10/25/50/100 resets cursor history without automatic scans", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    configureFixture({ rows }) {
      const template = structuredClone(rows[0]);
      rows.splice(
        0,
        rows.length,
        ...Array.from({ length: 121 }, (_, index) => ({
          ...structuredClone(template),
          contactId: `redesign-${index}`,
          fields: {
            ...template.fields,
            displayName: `Fictional ${String(index).padStart(3, "0")}`,
          },
        })),
      );
    },
    queryResponse(body, { rows }) {
      const offset = Number(body.cursor || 0);
      const next = offset + body.limit;
      return {
        ...pageIdentity(body),
        items: rows.slice(offset, next),
        nextCursor: next < rows.length ? String(next) : null,
        complete: next >= rows.length,
        total: next >= rows.length ? rows.length : null,
      };
    },
  });
  await openContacts(page);
  const sizes = page.getByRole("combobox", { name: "Rows per page" });
  await expect(sizes).toHaveValue("50");
  expect(
    await sizes
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
  ).toEqual(["10", "25", "50", "100"]);
  await expect(page.locator(".pt-contact-table tbody tr")).toHaveCount(50);
  expect(queryCalls(fixture)).toHaveLength(1);
  await page
    .getByRole("checkbox", { name: "Select Fictional 000", exact: true })
    .check();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Fictional 050", { exact: true })).toBeVisible();
  expect(lastQuery(fixture).cursor).toBe("50");
  for (const size of [10, 25, 100, 50]) {
    const before = queryCalls(fixture).length;
    await sizes.selectOption(String(size));
    await expect(page.locator(".pt-contact-table tbody tr")).toHaveCount(size);
    await expect(
      page.getByText("Fictional 000", { exact: true }),
    ).toBeVisible();
    await expect(sizes).toHaveValue(String(size));
    if (queryCalls(fixture).length > before) {
      expect(lastQuery(fixture).limit).toBe(size);
      expect(lastQuery(fixture).cursor).toBeFalsy();
    } else {
      // A cached first page is valid; a differently sized or later page is not.
      expect(
        queryCalls(fixture).some(
          (call) => call.body.limit === size && !call.body.cursor,
        ),
      ).toBe(true);
    }
    await expect(
      page.getByRole("button", { name: "Previous page", exact: true }),
    ).toBeDisabled();
  }
  await page.getByRole("button", { name: "View", exact: true }).click();
  const view = page.getByRole("dialog", { name: "View columns", exact: true });
  await view
    .getByRole("combobox", { name: "Rows per page", exact: true })
    .selectOption("25");
  if (await view.count())
    await view
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
  await expect(page.locator(".pt-contact-table tbody tr")).toHaveCount(25);
  await expect(sizes).toHaveValue("25");
  await expect(
    page.getByRole("checkbox", { name: "Select Fictional 000", exact: true }),
  ).toBeChecked();
  expect(queryCalls(fixture).length).toBeLessThanOrEqual(7);
  expect(fixture.errors).toEqual([]);
});

test("an empty incomplete page retains an explicit continuation and never claims the book is empty", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    queryResponse(body, { rows }) {
      return {
        ...pageIdentity(body),
        items: body.cursor ? rows : [],
        nextCursor: body.cursor ? null : "remaining-candidates",
        complete: !!body.cursor,
        total: body.cursor ? rows.length : null,
      };
    },
  });
  await openContacts(page);
  await expect(
    page.getByText("More contacts may match", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No matching contacts", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeEnabled();
  expect(queryCalls(fixture)).toHaveLength(1);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
  expect(queryCalls(fixture)).toHaveLength(2);
  expect(lastQuery(fixture).cursor).toBe("remaining-candidates");
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  expect(fixture.errors).toEqual([]);
});

test("simple district and upload filters compose AND with membership choices and use square checkboxes", async ({
  page,
}) => {
  const fixture = await mockBook(page);
  await openContacts(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter contacts" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("State", { exact: true })
    .selectOption({ label: "Montana" });
  await dialog.getByLabel("State House district", { exact: true }).fill("22");
  await dialog
    .getByRole("button", { name: "Tags & uploads", exact: true })
    .click();
  const first = dialog.getByRole("checkbox", { name: "List 1", exact: true });
  await first.check();
  await dialog.getByRole("checkbox", { name: "List 2", exact: true }).check();
  await dialog
    .getByRole("checkbox", { name: "Volunteer", exact: true })
    .check();
  const box = await first.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      type: element.type,
      width: parseFloat(style.width),
      height: parseFloat(style.height),
      radius: parseFloat(style.borderTopLeftRadius),
    };
  });
  expect(box.type).toBe("checkbox");
  expect(box.width).toBe(box.height);
  expect(box.width).toBeGreaterThanOrEqual(16);
  expect(box.radius).toBeLessThanOrEqual(4);
  expect(queryCalls(fixture)).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Show contacts", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => queryCalls(fixture).length).toBe(2);
  const filter = lastQuery(fixture).filter;
  expect(filter.op).toBe("and");
  expect(flatten(filter)).toEqual(
    expect.arrayContaining([
      { field: "state", op: "eq", value: "MT" },
      { field: "stateHouseDistrict", op: "eq", value: "22" },
      { field: "sources", op: "any", value: ["source-1", "source-2"] },
      { field: "tags", op: "any", value: ["tag-volunteer"] },
    ]),
  );
  expect(
    fixture.calls.some(
      (call) => call.path.includes("/indexes") || call.path.startsWith(PROMPT),
    ),
  ).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("all assigned tags are reachable from the compact row and an expandable contact section", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    configureFixture({ rows, tags }) {
      tags.push(
        { tagId: "event", label: "Event attendee", revision: 1 },
        { tagId: "follow", label: "Follow up", revision: 1 },
        { tagId: "neighbor", label: "New neighbor", revision: 1 },
      );
      rows[0].tags = tags.map((tag) => tag.tagId);
    },
  });
  await openContacts(page);
  const expand = page.getByRole("button", {
    name: "Show all 4 tags for Alex Example",
  });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(
    page.getByRole("heading", { name: "Alex Example", exact: true }),
  ).toBeVisible();
  const disclosure = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Show all tags (4)" }) });
  await expect(disclosure).toHaveCount(1);
  if (!(await disclosure.evaluate((element) => element.open)))
    await disclosure.locator("summary").click();
  for (const name of [
    "Volunteer",
    "Event attendee",
    "Follow up",
    "New neighbor",
  ])
    await expect(disclosure.getByText(name, { exact: true })).toBeVisible();
  await disclosure.locator("summary").click();
  await expect(disclosure).not.toHaveAttribute("open", "");
  expect(fixture.calls.some((call) => call.method === "PATCH")).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("the state-name picker retains an unfamiliar saved state while other filters change", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    configureFixture({ views, viewDefaults }) {
      views.push({
        viewId: "outside-state",
        name: "Imported state value",
        columns: ["displayName", "tags"],
        filter: { field: "state", op: "eq", value: "Imported region" },
      });
      viewDefaults.viewId = "outside-state";
    },
  });
  await openContacts(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter contacts" });
  const state = dialog.getByRole("combobox", { name: "State", exact: true });
  await expect(state).toHaveValue("Imported region");
  await expect(state.locator("option:checked")).toHaveText(
    "Saved value: Imported region",
  );
  await expect(state.locator('option[value="MT"]')).toHaveText("Montana");
  await dialog.getByLabel("State House district", { exact: true }).fill("23");
  await dialog
    .getByRole("button", { name: "Show contacts", exact: true })
    .click();
  await expect
    .poll(
      () =>
        flatten(lastQuery(fixture)?.filter).find(
          (rule) => rule.field === "stateHouseDistrict",
        )?.value,
    )
    .toBe("23");
  expect(flatten(lastQuery(fixture).filter)).toContainEqual({
    field: "state",
    op: "eq",
    value: "Imported region",
  });
  expect(fixture.errors).toEqual([]);
});

test("saved search, sort and columns restore without losing advanced OR rules", async ({
  page,
}) => {
  const nested = {
    op: "or",
    conditions: [
      { field: "sources", op: "eq", value: "source-1" },
      { field: "sources", op: "eq", value: "source-3" },
    ],
  };
  const fixture = await mockBook(page, {
    configureFixture({ views }) {
      views.push({
        viewId: "saved-redesign",
        revision: 1,
        name: "District follow-up",
        visibility: "private",
        search: "Example",
        columns: ["displayName", "stateHouseDistrict", "tags"],
        pinnedColumns: ["displayName"],
        sort: { field: "stateHouseDistrict", direction: "desc" },
        filter: {
          op: "and",
          conditions: [
            { field: "state", op: "eq", value: "MT" },
            { field: "stateHouseDistrict", op: "eq", value: "22" },
            nested,
          ],
        },
      });
    },
  });
  await openContacts(page);
  // Saved views remain accessible through View while ordinary filters stay simple.
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("button", { name: "Saved views & audiences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "District follow-up", exact: true })
    .click();
  await expect.poll(() => lastQuery(fixture)?.search).toBe("Example");
  expect(lastQuery(fixture).sort).toEqual({
    field: "stateHouseDistrict",
    direction: "desc",
  });
  expect(lastQuery(fixture).filter.conditions).toContainEqual(nested);
  await expect(
    page.getByRole("columnheader", {
      name: "State House district",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filter contacts" });
  await filters.getByLabel("State House district", { exact: true }).fill("23");
  await filters
    .getByRole("button", { name: "Show contacts", exact: true })
    .click();
  await expect
    .poll(
      () =>
        flatten(lastQuery(fixture)?.filter).find(
          (rule) => rule.field === "stateHouseDistrict",
        )?.value,
    )
    .toBe("23");
  expect(lastQuery(fixture).filter.conditions).toContainEqual(nested);
  expect(lastQuery(fixture).search).toBe("Example");
  expect(fixture.errors).toEqual([]);
});

test("book campaign handoff rechecks permissions, rebuilds selection and requires review without provider preparation", async ({
  page,
}) => {
  const fixture = await mockBook(page);
  await openContacts(page);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  expect(fixture.calls.some((call) => call.path === `${BOOK}/selections`)).toBe(
    false,
  );
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await expect(page).toHaveURL(/\/texting\/campaigns\/new$/);
  const review = page.getByRole("dialog", {
    name: "Review selection",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect
    .poll(
      () =>
        fixture.calls.filter((call) => call.path === `${BOOK}/selections`)
          .length,
    )
    .toBe(1);
  const permissionRead = fixture.calls.findIndex(
    (call) => call.path === `${PROMPT}/workspace`,
  );
  const rebuiltSelection = fixture.calls.findIndex(
    (call) => call.path === `${BOOK}/selections`,
  );
  expect(permissionRead).toBeGreaterThanOrEqual(0);
  expect(rebuiltSelection).toBeGreaterThan(permissionRead);
  expect(fixture.calls[rebuiltSelection].body).toMatchObject({
    mode: "explicit",
    includeIds: ["contact-1"],
    excludeIds: [],
  });
  await expect(
    page.getByLabel("I reviewed these campaign recipients", { exact: true }),
  ).not.toBeChecked();
  await review
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Fictional selected contact outreach");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Example Civic Team: join our meeting. Reply STOP to opt out.");
  await page.getByLabel("Spending limit ($)", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await expect(
    page.getByText(
      "Review and confirm the recipient selection before saving this campaign.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    fixture.calls.some(
      (call) => call.path === `${PROMPT}/campaigns` && call.method === "POST",
    ),
  ).toBe(false);
  expect(
    fixture.calls.some((call) => call.path.endsWith("/selection-1/campaign")),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Review selection", exact: true })
    .click();
  await page
    .getByLabel("I reviewed these campaign recipients", { exact: true })
    .check();
  await review
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixture.calls.filter(
          (call) =>
            call.path === `${PROMPT}/campaigns` && call.method === "POST",
        ).length,
    )
    .toBe(1);
  const binding = fixture.calls.find((call) =>
    call.path.endsWith("/selection-1/campaign"),
  );
  expect(binding.body.campaignId).toBe(
    fixture.calls.find(
      (call) => call.path === `${PROMPT}/campaigns` && call.method === "POST",
    ).body.campaignId,
  );
  expect(
    fixture.calls.some((call) =>
      /provider-sync|transition|\/prepare(?:$|\?)/.test(call.path),
    ),
  ).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("default contact book and filters fit desktop and narrow mobile layouts", async ({
  page,
}, testInfo) => {
  const fixture = await mockBook(page);
  for (const [name, width, height] of [
    ["desktop", 1365, 1000],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await openContacts(page);
    await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`contact-book-${name}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Filter contacts",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel("State House district", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`contact-filters-${name}.png`),
      fullPage: true,
    });
    expect(
      await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
  }
  expect(fixture.errors).toEqual([]);
});
