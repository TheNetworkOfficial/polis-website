const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");

async function openImport(page) {
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(page.getByText("Casey Example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add contacts", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload a file", exact: true })
    .click();
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function reviewFile(page, source, name = "fictional.csv") {
  await page
    .getByLabel("Contact file", { exact: true })
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(source) });
  await page
    .getByRole("button", { name: "Review contacts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review contacts", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
const source =
  'Name,Cell Phone,ZIP Code,Home Phone,First Name\n"Example, Alice B.",(202) 555-0123,00007,(202) 555-0199,\n';

test("whole-file name review, override, explicit-use gate and retained raw upload", async ({
  page,
}, testInfo) => {
  const { calls, errors } = await mockBook(page, { nameParsing: true });
  await openImport(page);
  await page.screenshot({
    path: testInfo.outputPath("import-choose-desktop.png"),
    fullPage: true,
  });
  await reviewFile(page, source);
  await expect(
    page.getByText("Whole file checked", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Alice / B. / Example", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import contacts", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Source namespace", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("1. Name", { exact: true })).not.toBeVisible();
  await page
    .getByLabel("Name format", { exact: true })
    .selectOption("given_family");
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByText(
      "0 source names can be split · 1 kept whole · 0 already supplied.",
      {
        exact: true,
      },
    ),
  ).toBeAttached();
  await page
    .getByLabel("Name format", { exact: true })
    .selectOption("family_given");
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByLabel("Permitted use", { exact: true })
    .selectOption("manual_sms");
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const preview = calls
    .filter((call) => call.path.endsWith("/import-preview"))
    .at(-1).body;
  expect(preview.namePolicy).toEqual({ version: 1, format: "family_given" });
  expect(preview.mapping).toMatchObject({
    0: "displayName",
    1: "phone",
    2: "postalCode",
    3: "__custom__",
    4: "firstName",
  });
  await page
    .getByLabel("I reviewed this source’s permitted use.", {
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Import contacts", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Permitted use", { exact: true })
    .selectOption("not_for_sms");
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByLabel("I reviewed this source’s permitted use.", {
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Import contacts", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Permitted use", { exact: true })
    .selectOption("manual_sms");
  await expect(page.locator("[data-workspace-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByLabel("I reviewed this source’s permitted use.", {
      exact: true,
    })
    .check();
  const permittedUse = page.getByLabel("Permitted use", { exact: true });
  const fieldMatching = page.locator("summary").filter({
    hasText: /^Field matching$/,
  });
  const advanced = page.locator("summary").filter({ hasText: /^Advanced$/ });
  const expectUnobscuredReviewControl = async (control) => {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    const body = await page.locator(".pt-import-review-body").boundingBox();
    const footer = await page.locator(".pt-import-footer").boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(body.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(footer.y + 1);
    expect(
      await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
  };
  await permittedUse.focus();
  await expect(permittedUse).toBeFocused();
  await expectUnobscuredReviewControl(permittedUse);
  await permittedUse.press("Tab");
  await expect(fieldMatching).toBeFocused();
  await fieldMatching.press("Enter");
  await expectUnobscuredReviewControl(
    page.getByLabel("1. Name", { exact: true }),
  );
  await fieldMatching.press("Enter");
  await fieldMatching.press("Tab");
  await expect(advanced).toBeFocused();
  await advanced.press("Enter");
  const sourceNamespace = page.getByLabel("Source namespace", { exact: true });
  await sourceNamespace.focus();
  await expect(sourceNamespace).toBeFocused();
  await expectUnobscuredReviewControl(sourceNamespace);
  await advanced.press("Enter");
  await page.locator(".pt-import-review-body").evaluate((body) => {
    body.scrollTop = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("import-review-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".pt-import-review-body").evaluate((body) => {
    body.scrollTop = 0;
  });
  const importButton = page.getByRole("button", {
    name: "Import contacts",
    exact: true,
  });
  const initialButton = await importButton.boundingBox();
  expect(initialButton.y).toBeGreaterThanOrEqual(0);
  expect(initialButton.y + initialButton.height).toBeLessThanOrEqual(844);
  const reviewBody = await page.locator(".pt-import-review-body").boundingBox();
  const footer = await page.locator(".pt-import-footer").boundingBox();
  const purpose = await page
    .getByLabel("Permitted use", { exact: true })
    .boundingBox();
  expect(reviewBody.y + reviewBody.height).toBeLessThanOrEqual(footer.y + 1);
  expect(purpose.y + purpose.height).toBeLessThanOrEqual(
    reviewBody.y + reviewBody.height + 1,
  );
  await page.screenshot({
    path: testInfo.outputPath("import-review-mobile-viewport.png"),
  });
  await page.screenshot({
    path: testInfo.outputPath("import-review-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await importButton.scrollIntoViewIfNeeded();
  const zoomButton = await importButton.boundingBox();
  expect(zoomButton.y).toBeGreaterThanOrEqual(0);
  expect(zoomButton.y + zoomButton.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: testInfo.outputPath("import-review-mobile-zoom.png"),
  });
  await page.evaluate(() => {
    document.body.style.zoom = "";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByText("1 source rows saved", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved. Almost ready.", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("import-saved-mobile.png"),
    fullPage: true,
  });
  expect(
    calls.find(
      (call) => call.path === `${BOOK}/imports` && call.method === "POST",
    ).body.namePolicy,
  ).toEqual({ version: 1, format: "family_given" });
  expect(
    calls.find(
      (call) =>
        call.path.endsWith("/imports/import-1/rows") && call.method === "POST",
    ).body.rows,
  ).toEqual([
    ["Example, Alice B.", "(202) 555-0123", "00007", "(202) 555-0199", ""],
  ]);
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  expect(errors).toEqual([]);
});

test("server-protected stored name parts replace the local name proposal", async ({
  page,
}) => {
  await mockBook(page, {
    nameParsing: true,
    previewNameAnalysis: {
      version: 1,
      sampleOnly: true,
      format: "family_given",
      suggestedFormat: "family_given",
      counts: { rows: 1, derived: 0, ambiguous: 0, explicit: 0, preserved: 1 },
      reasons: ["stored_name_parts_conflict"],
      examples: [
        {
          row: 0,
          original: "Example, Alice B.",
          firstName: "Existing",
          middleName: "C",
          lastName: "Protected",
          status: "preserved",
          reason: "stored_name_parts_conflict",
        },
      ],
    },
  });
  await openImport(page);
  await reviewFile(page, source);
  await expect(
    page.getByText("Existing / C / Protected · Existing parts kept", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Alice / B. / Example", { exact: true }),
  ).toHaveCount(0);
});

test("native File survives input replacement before the bubbling change handler", async ({
  page,
}) => {
  await mockBook(page, { nameParsing: true });
  await openImport(page);
  await page.getByLabel("Contact file", { exact: true }).evaluate((input) => {
    input.addEventListener(
      "input",
      () => {
        const replacement = input.cloneNode(true);
        replacement.value = "";
        input.replaceWith(replacement);
      },
      { once: true },
    );
  });
  await reviewFile(page, source);
  await expect(
    page.getByText("Alice / B. / Example", { exact: true }),
  ).toBeVisible();
});

test("sealed completion retries finalize the existing job without resending rows", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page, {
    resume: true,
    completing: true,
    nameParsing: true,
  });
  await openImport(page);
  await page
    .locator("summary")
    .filter({ hasText: /^Source history$/ })
    .click();
  await page
    .getByRole("button", { name: "Finish import", exact: true })
    .click();
  await expect(
    page.getByText("1 source rows saved", { exact: true }),
  ).toBeVisible();
  const completion = calls.find((call) =>
    call.path.endsWith("/imports/import-1/complete"),
  );
  expect(completion.body).toEqual({
    operationId: "finalize:import-1",
    expectedRowCount: 1,
  });
  expect(
    calls.some(
      (call) =>
        call.method === "POST" &&
        (call.path === `${BOOK}/imports` || call.path.endsWith("/rows")),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("a conflicting order after row25 changes Auto to keep across the whole file", async ({
  page,
}) => {
  const { calls } = await mockBook(page, { nameParsing: true });
  await openImport(page);
  await reviewFile(
    page,
    "Name\n" +
      Array(26).fill('"Example, Alice B"').join("\n") +
      "\nAlice Example\n",
  );
  await expect(
    page.getByText(
      "0 source names can be split · 27 kept whole · 0 already supplied.",
      {
        exact: true,
      },
    ),
  ).toBeAttached();
  const payload = calls.find((call) =>
    call.path.endsWith("/import-preview"),
  ).body;
  expect(payload.rows).toHaveLength(25);
  expect(payload.namePolicy.format).toBe("keep");
});

test("missing server name-analysis support makes the client keep full names", async ({
  page,
}) => {
  const { calls } = await mockBook(page, {
    nameParsing: true,
    previewNameAnalysis: false,
  });
  await openImport(page);
  await reviewFile(page, source);
  await expect(
    page.getByText(
      "Automatic name conversion is unavailable on this server. Original names and columns stay.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Name format", { exact: true })).toHaveValue(
    "keep",
  );
  await page
    .getByLabel("I reviewed this source’s permitted use.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByText("1 source rows saved", { exact: true }),
  ).toBeVisible();
  expect(
    calls.find(
      (call) => call.path === `${BOOK}/imports` && call.method === "POST",
    ).body.namePolicy.format,
  ).toBe("keep");
});

test("late malformed rows fail review before any import writes", async ({
  page,
}) => {
  const { calls } = await mockBook(page, { nameParsing: true });
  await openImport(page);
  await page.getByLabel("Contact file", { exact: true }).setInputFiles({
    name: "fictional.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Name,ZIP\n" +
        Array(26).fill("Alice Example,00007").join("\n") +
        "\nBad,00008,extra\n",
    ),
  });
  await page
    .getByRole("button", { name: "Review contacts", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("more cells");
  expect(
    calls.some(
      (call) => call.path === `${BOOK}/imports` && call.method === "POST",
    ),
  ).toBe(false);
});

test("failed same-query refresh retains confirmed contacts and total", async ({
  page,
}) => {
  let fail = false;
  await mockBook(page, {
    queryResponse: (body, fixture) => {
      if (fail) throw new Error("synthetic_refresh_failure");
      return { items: fixture.rows, total: 3, complete: true, bookRevision: 7 };
    },
  });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(page.getByText("Alex Example", { exact: true })).toBeAttached();
  fail = true;
  await page.route(`**${BOOK}/query`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "synthetic_refresh_failure" }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh contacts", exact: true })
    .click();
  await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
  await expect(
    page.getByText("3 matching contacts", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Refresh unavailable. Showing the last confirmed contacts.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("No matching contacts", { exact: true }),
  ).toHaveCount(0);
});
