const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK } = require("./contact-book-fixture.cjs");
const open = async (page) => {
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(
    page.getByRole("heading", { name: "Contact book", exact: true }),
  ).toBeVisible();
};

const coordinateFields = ["country", "latitude", "longitude"].map(
  (fieldId) => ({
    fieldId,
    label: fieldId,
    type: "text",
    filterable: true,
    sortable: true,
    group: "address",
  }),
);

test("new advanced, sort and view choices omit country and coordinates", async ({
  page,
}) => {
  await mockBook(page, {
    configureFixture({ fields }) {
      fields.push(...coordinateFields);
    },
  });
  await open(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("button", { name: "Advanced rules", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  const advanced = page.getByRole("dialog", {
    name: "Advanced rules",
    exact: true,
  });
  for (const field of coordinateFields)
    await expect(
      advanced
        .getByLabel("Field", { exact: true })
        .locator(`option[value="${field.fieldId}"]`),
    ).toHaveCount(0);
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  for (const field of coordinateFields)
    await expect(
      page
        .getByLabel("Sort by", { exact: true })
        .locator(`option[value="${field.fieldId}"]`),
    ).toHaveCount(0);
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  for (const field of coordinateFields)
    await expect(
      page
        .getByRole("dialog", { name: "View columns" })
        .getByLabel(field.label, { exact: true }),
    ).toHaveCount(0);
});

test("saved coordinate conditions, sort and columns remain intact", async ({
  page,
}) => {
  const filter = {
    op: "or",
    conditions: [
      { field: "country", op: "eq", value: "US" },
      { field: "latitude", op: "gt", value: "46" },
    ],
  };
  const fixture = await mockBook(page, {
    configureFixture({ fields, views, viewDefaults }) {
      fields.push(...coordinateFields);
      views.push({
        viewId: "legacy-coordinates",
        name: "Saved geography",
        filter,
        sort: { field: "latitude", direction: "asc" },
        columns: ["displayName", "latitude"],
      });
      viewDefaults.viewId = "legacy-coordinates";
    },
  });
  await open(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: /Advanced rules/ }).click();
  const advanced = page.getByRole("dialog", {
    name: "Advanced rules",
    exact: true,
  });
  await expect(
    advanced.getByLabel("Field", { exact: true }).nth(0),
  ).toHaveValue("country");
  await expect(
    advanced.getByLabel("Field", { exact: true }).nth(1),
  ).toHaveValue("latitude");
  await advanced.getByRole("button", { name: "Apply", exact: true }).click();
  expect(
    fixture.calls.filter((c) => c.path === `${BOOK}/query`).at(-1).body.filter,
  ).toEqual({ op: "and", conditions: [filter] });
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await expect(page.getByLabel("Sort by", { exact: true })).toHaveValue(
    "latitude",
  );
  await page.getByRole("button", { name: "Apply sort", exact: true }).click();
  expect(
    fixture.calls.filter((c) => c.path === `${BOOK}/query`).at(-1).body.sort,
  ).toEqual({ field: "latitude", direction: "asc" });
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "View columns" })
      .getByLabel("latitude", { exact: true }),
  ).toBeChecked();
  await expect(
    page
      .getByRole("dialog", { name: "View columns" })
      .getByLabel("longitude", { exact: true }),
  ).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test("unrelated edits retain raw district, precinct, unfamiliar party and tags without tag permission", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    capabilities: { tag: false },
    configureFixture({ fields, rows }) {
      fields.push({
        fieldId: "congressionalDistrict",
        label: "Congressional district",
        type: "text",
        group: "Identity",
        filterable: true,
        sortable: true,
      });
      fields.push({
        fieldId: "precinct",
        label: "Precinct",
        type: "text",
        group: "Identity",
        filterable: true,
        sortable: true,
      });
      fields.push({
        fieldId: "party",
        label: "Source party",
        type: "single_choice",
        group: "Identity",
        options: ["Democratic", "Republican"],
        allowUnknown: true,
      });
      Object.assign(rows[0].fields, {
        congressionalDistrict: "02",
        precinct: "0007",
        party: "Legacy local party",
      });
      rows[0].tags = ["tag-volunteer"];
    },
  });
  await open(page);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByLabel("Congressional district", { exact: true }).check();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "MT-02", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await expect(page.getByLabel("Source party", { exact: true })).toHaveValue(
    "Legacy local party",
  );
  await expect(
    page.getByLabel("Congressional district", { exact: true }),
  ).toHaveValue("02");
  await page.getByLabel("Name", { exact: true }).fill("Alex Updated");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect
    .poll(() => fixture.calls.filter((c) => c.method === "PATCH").length)
    .toBe(1);
  const body = fixture.calls.find((c) => c.method === "PATCH").body;
  expect(body.fields).toEqual({ displayName: "Alex Updated" });
  expect(body.tags).toBeUndefined();
  expect(fixture.errors).toEqual([]);
});

test("saved legacy city remains selected when absent from the public catalog", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    configureFixture({ views, viewDefaults }) {
      views.push({
        viewId: "saved-city",
        name: "Legacy city",
        filter: {
          op: "and",
          conditions: [
            { field: "state", op: "eq", value: "MT" },
            { field: "city", op: "eq", value: "Former Township" },
          ],
        },
      });
      viewDefaults.viewId = "saved-city";
    },
  });
  await open(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter contacts" });
  await dialog
    .getByText("City, address & local districts", { exact: true })
    .click();
  await expect(dialog.getByLabel("City", { exact: true })).toHaveValue(
    "Former Township",
  );
  await expect(dialog.getByLabel("City", { exact: true })).toBeEnabled();
  await dialog.getByLabel("State House district", { exact: true }).fill("22");
  await dialog
    .getByRole("button", { name: "Show contacts", exact: true })
    .click();
  expect(
    fixture.calls.filter((c) => c.path === `${BOOK}/query`).at(-1).body.filter
      .conditions,
  ).toContainEqual({ field: "city", op: "eq", value: "Former Township" });
});
test("simple filters hide coordinates, use state cities and schema voter choices, and keep compact grids", async ({
  page,
}, info) => {
  const fixture = await mockBook(page, {
    configureFixture({ fields }) {
      fields.push(
        ...["country", "latitude", "longitude"].map((fieldId) => ({
          fieldId,
          label: fieldId,
          type: "text",
          group: "address",
        })),
      );
      fields.push(
        ...["registrationStatus", "party", "selfReportedParty"].map(
          (fieldId) => ({
            fieldId,
            label: fieldId,
            type: "single_choice",
            group: "voter",
            filterable: true,
            options: ["Active", "Unknown"],
          }),
        ),
      );
      fields.push({
        fieldId: "lastVisit",
        label: "Last visit",
        type: "date",
        group: "activity",
        filterable: true,
      });
    },
  });
  await open(page);
  expect(
    fixture.calls.filter(
      (c) => c.path === `${BOOK}/views` || c.path === `${BOOK}/audiences`,
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter contacts" });
  await expect(
    dialog.getByRole("heading", { name: "Location & districts", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByText("City, address & local districts", { exact: true })
    .click();
  await expect(dialog.getByLabel("City", { exact: true })).toBeDisabled();
  await dialog.getByLabel("State", { exact: true }).selectOption("MT");
  // Catalog rerenders the controls; reopen the local fields if needed.
  await expect(dialog.getByLabel("City", { exact: true })).toBeEnabled();
  await dialog.getByLabel("Find a city", { exact: true }).fill("bill");
  await expect(
    dialog.getByLabel("City", { exact: true }).locator("option"),
  ).toHaveText(["Any city", "Billings"]);
  await dialog.getByLabel("City", { exact: true }).selectOption("Billings");
  await expect(dialog.getByLabel("country", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("latitude", { exact: true })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Voter information", exact: true })
    .click();
  for (const label of ["registrationStatus", "party", "selfReportedParty"])
    await expect(dialog.getByLabel(label, { exact: true })).toHaveJSProperty(
      "tagName",
      "SELECT",
    );
  await dialog
    .getByRole("button", { name: "Texting status", exact: true })
    .click();
  expect(
    await dialog
      .locator(".pt-cb-choice-grid")
      .first()
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("refined-texting-filters-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Outreach & activity", exact: true })
    .click();
  const gap = await dialog.locator(".pt-cb-simple-field").evaluate((el) => {
    const labels = el.querySelectorAll("label");
    return (
      labels[1].getBoundingClientRect().top -
      labels[0].getBoundingClientRect().bottom
    );
  });
  expect(gap).toBeLessThanOrEqual(12);
  await dialog
    .getByRole("button", { name: "Show contacts", exact: true })
    .click();
  expect(
    fixture.calls.filter((c) => c.path === `${BOOK}/query`).at(-1).body.filter
      .conditions,
  ).toEqual(
    expect.arrayContaining([
      { field: "city", op: "eq", value: "Billings" },
      { field: "state", op: "eq", value: "MT" },
    ]),
  );
  expect(fixture.errors).toEqual([]);
});

test("tag actions offer creation only to tag managers and align without empty selects", async ({
  page,
}, info) => {
  const fixture = await mockBook(page, {
    configureFixture({ tags }) {
      tags.splice(0);
    },
  });
  await open(page);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Selection actions" });
  await expect(
    dialog.getByRole("combobox", { name: "Tag", exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("New tag", { exact: true }).fill("Follow up");
  await dialog.getByRole("button", { name: "Create tag", exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Tag", exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .getByRole("combobox", { name: "Tag", exact: true })
      .locator("option"),
  ).toContainText(["Follow up"]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("refined-selection-mobile.png"),
    fullPage: true,
  });
  expect(fixture.calls.filter((c) => c.path === `${BOOK}/tags`)).toHaveLength(
    1,
  );
});

test("book reader cannot create tags or campaigns without their separate grants", async ({
  page,
}) => {
  const fixture = await mockBook(page, {
    capabilities: { tag: false, edit: false, manage: false, campaign: false },
    configureFixture({ tags }) {
      tags.splice(0);
    },
  });
  await open(page);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Create campaign", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create tag", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "No tags are available. A contact tag manager can create them.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    fixture.calls.some((c) => c.method !== "GET" && c.path !== `${BOOK}/query`),
  ).toBe(false);
});
