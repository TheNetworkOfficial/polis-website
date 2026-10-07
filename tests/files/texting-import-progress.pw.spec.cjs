const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");

test("a lost saved-import read keeps the import resumable without starting another import", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page, { resume: true });
  let reads = 0;
  await page.route(`**${BOOK}/imports/import-1`, (route) => {
    if (++reads === 1) return route.abort("failed");
    return route.fallback();
  });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("button", { name: "More contact tools", exact: true })
    .click();
  await page.getByRole("button", { name: "Imports", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    calls.some(
      (call) => call.method === "POST" && call.path.endsWith("/imports"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByText("Resume interrupted.csv", { exact: true }),
  ).toBeVisible();
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
  expect(reads).toBe(2);
  expect(
    calls.some(
      (call) => call.method === "POST" && call.path === `${BOOK}/imports`,
    ),
  ).toBe(false);
  const rows = calls.filter(
    (call) => call.method === "POST" && call.path.endsWith("/rows"),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].path).toBe(`${BOOK}/imports/import-1/rows`);
  expect(rows[0].body.startRow).toBe(0);
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  expect(errors).toEqual([]);
});
