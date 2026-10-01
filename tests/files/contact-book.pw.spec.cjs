const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");

async function closePanel(page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    await dialog
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
}
async function openAdvanced(page) {
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: /^Advanced rules/ }).click();
}
async function openTool(page, name) {
  await page
    .getByRole("button", { name: "More contact tools", exact: true })
    .click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function openSaved(page) {
  const control = page.getByRole("button", {
    name: "Saved views & audiences",
    exact: true,
  });
  if (await control.count()) await control.click();
  else
    await page.getByRole("button", { name: "Save view", exact: true }).click();
}

test("shared contact book works without provider setup, retains custom columns, and edits a shared contact", async ({
  page,
}, testInfo) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(
    page.getByRole("heading", { name: "Contact book", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByLabel("Special tax district", { exact: true }).check();
  await page.getByLabel("Tag: Volunteer", { exact: true }).check();
  await closePanel(page);
  await expect(
    page.getByRole("columnheader", { name: "Special tax district" }),
  ).toBeVisible();
  await page.getByLabel("Volunteer for Alex Example", { exact: true }).check();
  await expect
    .poll(() => calls.filter((call) => call.method === "PATCH").length)
    .toBe(1);
  expect(calls.find((call) => call.method === "PATCH").body.tags).toEqual([
    "tag-volunteer",
  ]);
  await closePanel(page);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Alex Updated");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Alex Updated" }),
  ).toBeVisible();
  const patch = calls.filter((call) => call.method === "PATCH").at(-1).body;
  expect(patch.fields).toEqual({ displayName: "Alex Updated" });
  expect(patch.expectedRevision).toBe(2);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("shared-contacts-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("shared-contacts-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("shared-contacts-default-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("shared-contacts-default-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
});

test("pending publication labels current matches and refresh removes the notice when ready", async ({
  page,
}, testInfo) => {
  const publication = { status: "updating", pending: 17 };
  const { errors } = await mockBook(page, { publication });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(
    page.getByText("Contacts updating", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/17 updates pending/)).toBeVisible();
  await expect(
    page.getByText("2 published matches loaded · more pages available", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Select all published matches",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("publication-pending-mobile.png"),
    fullPage: true,
  });
  publication.status = "ready";
  publication.pending = 0;
  await page
    .getByRole("button", { name: "Refresh contacts", exact: true })
    .click();
  await expect(
    page.getByText("Contacts updating", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Select all matching", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("campaign selection covers all pages, preserves exclusions, and binds locally before any provider preparation", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/new`);
  await expect(
    page.getByRole("heading", { name: "Choose campaign recipients" }),
  ).toBeVisible();
  await openAdvanced(page);
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .nth(0)
    .selectOption("sources");
  await page
    .getByRole("listbox", { name: "Import sources", exact: true })
    .selectOption(["source-1", "source-2", "source-3"]);
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .nth(1)
    .selectOption("state");
  await page.getByLabel("Value", { exact: true }).nth(0).fill("MT");
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .nth(2)
    .selectOption("stateHouseDistrict");
  await page.getByLabel("Value", { exact: true }).nth(1).fill("22");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      () =>
        calls.filter(
          (call) => call.path.endsWith("/query") && call.body?.filter,
        ).length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Select all matching", exact: true })
    .click();
  await expect(
    page.getByLabel("Select Blair Example", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Select Blair Example", { exact: true }).uncheck();
  await expect(
    page.getByText("All matching contacts, excluding 1", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review selection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review selected contacts" }),
  ).toBeVisible();
  const selected = calls.find((call) => call.path.endsWith("/selections")).body;
  expect(selected.mode).toBe("all_matching");
  expect(selected.excludeIds).toEqual(["contact-2"]);
  expect(selected.expectedBookRevision).toBe(7);
  expect(selected.query.filter).toEqual({
    op: "and",
    conditions: [
      {
        field: "sources",
        op: "any",
        value: ["source-1", "source-2", "source-3"],
      },
      { field: "state", op: "eq", value: "MT" },
      { field: "stateHouseDistrict", op: "eq", value: "22" },
    ],
  });
  await page
    .getByLabel("I reviewed these campaign recipients", { exact: true })
    .check();
  await closePanel(page);
  await page
    .getByRole("button", { name: "Next: Write message", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("House 22 outreach");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "House 22 outreach",
  );
  expect(
    await page.evaluate(
      () =>
        document.activeElement.closest("[data-workspace-form]")?.dataset
          .workspaceForm,
    ),
  ).toBe("campaign");
  await page
    .getByLabel("Message", { exact: true })
    .fill(
      "Example Civic Team: our meeting is Saturday. Reply STOP to opt out.",
    );
  await page.getByLabel("Spending limit ($)", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await expect
    .poll(
      () =>
        calls.filter(
          (call) =>
            call.path === `${PROMPT}/campaigns` && call.method === "POST",
        ).length,
    )
    .toBe(1);
  const binding = calls.find((call) =>
    call.path.endsWith("/selections/selection-1/campaign"),
  );
  const save = calls.find(
    (call) => call.path === `${PROMPT}/campaigns` && call.method === "POST",
  );
  expect(binding.body.campaignId).toBe(save.body.campaignId);
  expect(save.body.audienceId).toBe("contactbook:selection-1");
  expect(calls.some((call) => /provider-sync|transition/.test(call.path))).toBe(
    false,
  );
  expect(errors).toEqual([]);
});

test("contact import streams raw custom values into Polis without external transfer", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page.getByRole("button", { name: "Add contacts", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload a file", exact: true })
    .click();
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("Contact file", { exact: true }).setInputFiles({
    name: "example.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Name,Special tax district,Unfamiliar column\nExample Person,0007,"kept, exactly"\n',
    ),
  });
  await page
    .getByRole("button", { name: "Preview columns", exact: true })
    .click();
  await page
    .getByLabel("Source namespace", { exact: true })
    .fill("example-arizona-2026");
  await page
    .getByRole("button", { name: "Review sample matches", exact: true })
    .click();
  await expect(
    page.getByText(/This review covers only 1 sample records/),
  ).toBeVisible();
  await page
    .getByLabel("I reviewed these columns and the source’s permitted use", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByText(
      "File saved. Contact search and related views are updating.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const upload = calls.find((call) =>
    call.path.endsWith("/imports/import-1/rows"),
  );
  expect(upload.body.rows).toEqual([
    ["Example Person", "0007", "kept, exactly"],
  ]);
  await page
    .getByRole("button", { name: "Review records", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Import record report" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "conflict", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Compare source record", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Original source record 1" }),
  ).toBeVisible();
  await expect(page.getByText("Source Example", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Use source value for Name", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((call) => call.method === "PATCH").length)
    .toBe(1);
  expect(calls.find((call) => call.method === "PATCH").body.fields).toEqual({
    displayName: "Source Example",
  });
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  expect(errors).toEqual([]);
});

test("nested audience groups preserve AND, OR and exclusions when applying", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await openAdvanced(page);
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page.getByLabel("Value", { exact: true }).fill("MT");
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .nth(1)
    .selectOption("stateHouseDistrict");
  await page.getByLabel("Value", { exact: true }).nth(1).fill("22");
  await page
    .getByRole("group", { name: "Condition group" })
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .nth(2)
    .selectOption("stateHouseDistrict");
  await page.getByLabel("Value", { exact: true }).nth(2).fill("23");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      () =>
        calls.filter(
          (call) => call.path.endsWith("/query") && call.body?.filter,
        ).length,
    )
    .toBe(1);
  const filter = calls.filter((call) => call.path.endsWith("/query")).at(-1)
    .body.filter;
  expect(filter).toEqual({
    op: "and",
    conditions: [
      { field: "state", op: "eq", value: "MT" },
      {
        op: "or",
        conditions: [
          { field: "stateHouseDistrict", op: "eq", value: "22" },
          { field: "stateHouseDistrict", op: "eq", value: "23" },
        ],
      },
    ],
  });
  await openAdvanced(page);
  await page
    .getByRole("combobox", { name: "Group match", exact: true })
    .selectOption("not");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      () =>
        calls.filter(
          (call) => call.path.endsWith("/query") && call.body?.filter,
        ).length,
    )
    .toBe(2);
  expect(
    calls.filter((call) => call.path.endsWith("/query")).at(-1).body.filter
      .conditions[1],
  ).toEqual({ op: "not", conditions: [filter.conditions[1]] });
  expect(errors).toEqual([]);
});

test("field conversions show changed values and require explicit apply", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await openTool(page, "Fields and tags");
  await page.getByRole("button", { name: "Change type", exact: true }).click();
  await page
    .getByRole("combobox", { name: "New type", exact: true })
    .selectOption("number");
  await page
    .getByRole("button", { name: "Preview conversion", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "0007", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "7", exact: true }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.endsWith("/apply"))).toBe(false);
  await page
    .getByRole("button", { name: "Apply reviewed conversion", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((call) => call.path.endsWith("/apply")).length)
    .toBe(1);
  await expect(
    page.getByText("complete · 3 checked · 0 need review", { exact: true }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  expect(errors).toEqual([]);
});

test("reload resume verifies original headers and replays saved rows into the same import", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page, { resume: true });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page.reload();
  await openTool(page, "Imports");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByText("Resume interrupted.csv", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("Contact file", { exact: true }).setInputFiles({
    name: "wrong.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Wrong column\nExample One,0007\n"),
  });
  await page
    .getByRole("button", { name: "Preview columns", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "different columns or column order",
  );
  expect(
    calls.some((call) => call.method === "POST" && call.path.endsWith("/rows")),
  ).toBe(false);
  await page.getByLabel("Contact file", { exact: true }).setInputFiles({
    name: "original.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Name,Special tax district\nExample One,0007\nExample Two,0012\n",
    ),
  });
  await page
    .getByRole("button", { name: "Preview columns", exact: true })
    .click();
  await page
    .getByLabel("I reviewed these columns and the source’s permitted use", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Resume import", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((call) => call.path.endsWith("/complete")).length)
    .toBe(1);
  expect(
    calls.some(
      (call) => call.path === `${BOOK}/imports` && call.method === "POST",
    ),
  ).toBe(false);
  const replay = calls.find(
    (call) => call.method === "POST" && call.path.endsWith("/rows"),
  );
  expect(replay.path).toBe(`${BOOK}/imports/import-1/rows`);
  expect(replay.body.startRow).toBe(0);
  expect(replay.body.rows).toEqual([
    ["Example One", "0007"],
    ["Example Two", "0012"],
  ]);
  expect(errors).toEqual([]);
});

test("shared destination conflicts prevent campaign confirmation and local binding", async ({
  page,
}) => {
  const { calls } = await mockBook(page, { duplicate: true });
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/new`);
  await page
    .getByRole("button", { name: "Select all matching", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review selection", exact: true })
    .click();
  await expect(
    page.getByText("Shared phone numbers need review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("I reviewed these campaign recipients", { exact: true }),
  ).toBeDisabled();
  expect(
    calls.some((call) =>
      call.path.endsWith("/selections/selection-1/campaign"),
    ),
  ).toBe(false);
});

test("retained invalid values require an explicit correction and survive unrelated edits", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page, { issues: true });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await closePanel(page);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await expect(page.getByText("sometimes", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Retained original value · needs boolean review.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Updated Example");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect
    .poll(() => calls.filter((call) => call.method === "PATCH").length)
    .toBe(1);
  expect(calls.find((call) => call.method === "PATCH").body.fields).toEqual({
    displayName: "Updated Example",
  });
  await expect(page.getByText("sometimes", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("bulk outcomes, guarded undo, source removal and related-view repair use local APIs", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Tag", exact: true })
    .selectOption("tag-volunteer");
  await page.getByRole("button", { name: "Apply tag", exact: true }).click();
  await page
    .getByRole("button", { name: "Review tag results", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "applied", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Undo this tag update", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "undone", exact: true }),
  ).toBeVisible();
  await closePanel(page);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await page.getByText("Sources", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove source membership", exact: true })
    .click();
  await expect
    .poll(
      () =>
        calls.filter((call) => call.path.endsWith("/sources/remove")).length,
    )
    .toBe(1);
  const removal = calls.find((call) => call.path.endsWith("/sources/remove"));
  expect(removal.body.sourceRecordId).toBe("record-1");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await openTool(page, "Sync status");
  await expect(
    page.getByText("Contact index is up to date", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check related views", exact: true })
    .click();
  await expect(
    page.getByText(/1 pending texting restriction updates/),
  ).toBeVisible();
  await expect(page.getByText(/More work remains/)).toBeVisible();
  await page
    .getByRole("button", { name: "Continue related-view check", exact: true })
    .click();
  await expect(
    page.getByText(/Texting restrictions:.*Check complete/),
  ).toBeVisible();
  expect(
    calls
      .filter((call) => call.path.endsWith("/reconcile"))
      .map((call) => call.body.phase),
  ).toEqual(["contacts", "restrictions"]);
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  expect(errors).toEqual([]);
});

test("structured values retain nested properties and merge choices use reviewed source values", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await closePanel(page);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  const editor = page.getByRole("textbox", {
    name: "Additional addresses (JSON)",
    exact: true,
  });
  const original = JSON.parse(await editor.inputValue());
  expect(original[0].custom).toEqual({ tax: "0007", visited: false });
  await editor.fill('{"broken":');
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Check the structured value",
  );
  expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
  original[0].custom.tax = "0012";
  await editor.fill(JSON.stringify(original));
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect
    .poll(() => calls.filter((call) => call.method === "PATCH").length)
    .toBe(1);
  expect(calls.find((call) => call.method === "PATCH").body.fields).toEqual({
    addresses: original,
  });
  await page.getByText("Review duplicate contacts", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Find a possible duplicate", exact: true })
    .fill("Blair");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button", { name: "Review duplicate", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: /^Name$/ })
    .click();
  await page
    .getByRole("combobox", { name: "Value for Name", exact: true })
    .selectOption("source");
  await page
    .getByRole("button", { name: "Merge reviewed duplicate", exact: true })
    .click();
  await expect
    .poll(
      () =>
        calls.filter((call) => call.path.endsWith("/identities/merge")).length,
    )
    .toBe(1);
  expect(
    calls.find((call) => call.path.endsWith("/identities/merge")).body
      .fieldChoices,
  ).toEqual({
    displayName: "Blair Example",
    phone: "+12025550121",
    addresses: original,
  });
  expect(errors).toEqual([]);
});

test("column order and private visibility are saved with the view", async ({
  page,
}) => {
  const { calls } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByText("Column order & pinning", { exact: true }).click();
  await page
    .locator(
      '[data-workspace-action="book-column-earlier"][data-value="phone"]',
    )
    .click();
  await openSaved(page);
  await page
    .getByRole("textbox", { name: "Save this view as", exact: true })
    .fill("My contact layout");
  await page
    .getByRole("combobox", { name: "Who can use this view", exact: true })
    .selectOption("private");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await expect
    .poll(
      () =>
        calls.filter(
          (call) => call.path.endsWith("/views") && call.method === "POST",
        ).length,
    )
    .toBe(1);
  const saved = calls.find(
    (call) => call.path.endsWith("/views") && call.method === "POST",
  ).body;
  expect(saved.columns).toEqual([
    "phone",
    "displayName",
    "eligibility",
    "tags",
  ]);
  expect(saved.visibility).toBe("private");
});

test("saved layouts can be edited, pinned, and published as the organization default", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByText("Column order & pinning", { exact: true }).click();
  await page
    .locator('[data-contact-change="book-column-pin"][value="displayName"]')
    .check();
  await openSaved(page);
  await page
    .getByRole("textbox", { name: "Save this view as", exact: true })
    .fill("Shared contact view");
  await page
    .getByRole("combobox", { name: "Who can use this view", exact: true })
    .selectOption("organization");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByRole("button", { name: "Edit layout", exact: true }).click();
  await page
    .getByRole("textbox", { name: "View name", exact: true })
    .fill("Edited contact view");
  await page
    .getByRole("button", { name: "Save view changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set organization default", exact: true })
    .click();
  await expect(page.getByText(/Organization default$/)).toBeVisible();
  const edit = calls.find(
    (call) => call.path.endsWith("/views/view-1") && call.method === "PATCH",
  );
  expect(edit.body).toMatchObject({
    name: "Edited contact view",
    pinnedColumns: ["displayName"],
    expectedRevision: 1,
  });
  expect(
    calls.find((call) => call.path.endsWith("/view-default")).body,
  ).toMatchObject({ viewId: "view-1", expectedRevision: 0 });
  expect(errors).toEqual([]);
});

test("batch local district review, selected source removal, and current linked activity remain inside Polis", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByText("More selection actions", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Update districts for selection",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/Alex Example · local address coverage unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Potentially affected saved views and audiences",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    calls.some((call) =>
      call.path.endsWith("/geography-refresh/geography-1/apply"),
    ),
  ).toBe(false);
  await page
    .getByRole("button", {
      name: "Apply reviewed district updates",
      exact: true,
    })
    .click();
  await expect
    .poll(
      () =>
        calls.filter((call) =>
          call.path.endsWith("/geography-refresh/geography-1/apply"),
        ).length,
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Undo this tag update", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Source membership to remove", exact: true })
    .selectOption("source-1");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove source from selection", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((call) => call.path.endsWith("/bulk")).length)
    .toBe(1);
  expect(
    calls
      .filter((call) => call.path.endsWith("/bulk"))
      .map((call) => call.body.action),
  ).toEqual(["source_remove"]);
  expect(
    calls.filter((call) => call.path.endsWith("/bulk"))[0].body.sourceId,
  ).toBe("source-1");
  await closePanel(page);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await page.getByText("Linked activity", { exact: true }).click();
  await page
    .getByRole("button", { name: "Follow-up requests", exact: true })
    .click();
  await expect(
    page.locator("pre").filter({ hasText: '"status": "fulfilled"' }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  expect(errors).toEqual([]);
});

test("tag groups create readable columns and filter through stable member tags", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await openTool(page, "Fields and tags");
  const editor = page.locator('[data-workspace-form="book-tag-rename"]');
  await editor
    .getByRole("textbox", { name: "New group name", exact: true })
    .fill("Interests");
  await editor.getByRole("button", { name: "Rename", exact: true }).click();
  await expect
    .poll(
      () =>
        calls.filter((call) => call.path.endsWith("/tags/tag-volunteer"))
          .length,
    )
    .toBe(1);
  const group = calls.find((call) =>
    call.path.endsWith("/tags/tag-volunteer"),
  ).body;
  expect(group.groupId).toMatch(/^group_/);
  expect(group.groupLabel).toBe("Interests");
  await page
    .getByRole("button", { name: "Back to contacts", exact: true })
    .click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Tag group: Interests", exact: true })
    .check();
  await closePanel(page);
  await expect(
    page.getByRole("columnheader", { name: "Interests", exact: true }),
  ).toBeVisible();
  await openAdvanced(page);
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .selectOption(`tag_group:${group.groupId}`);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const query = calls
    .filter((call) => call.path.endsWith("/query"))
    .at(-1).body;
  expect(query.filter).toEqual({
    op: "and",
    conditions: [{ field: "tags", op: "any", value: ["tag-volunteer"] }],
  });
  expect(errors).toEqual([]);
});

test("an administrator can recover and finish an abandoned schema update without clearing its lock", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page, { recovery: true });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await openTool(page, "Sync status");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Take over and finish update", exact: true })
    .click();
  await expect(
    page.getByText("Recovered update", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Take over and finish update",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    calls.filter((call) => call.path.endsWith("/schema-job/recover")),
  ).toHaveLength(1);
  expect(
    calls.some((call) => call.path.endsWith("/conversions/convert-1/advance")),
  ).toBe(true);
  expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  expect(errors).toEqual([]);
});
