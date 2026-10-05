const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK } = require("./contact-book-fixture.cjs");

for (const width of [1280, 390]) {
  test(`household address, tags and journal at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mockBook(page, {
      configureFixture({ rows, fields }) {
        rows[0] = {
          contactId: "contact-1",
          recordKind: "household",
          revision: 2,
          status: "active",
          fields: {
            addressLabel: "42 Example Lane",
            addressResolution: { status: "unverified" },
          },
          tags: [],
          sources: [
            {
              sourceId: "door",
              sourceRecordId: "location-1",
              label: "DoorKnocker",
            },
          ],
        };
        fields.push({
          fieldId: "addressLabel",
          label: "Address label",
          group: "Address",
          type: "text",
          readOnly: true,
        });
      },
    });
    await page.route(
      "**/api/contact-book/scopes/*/contacts/contact-1/activity*",
      async (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            kind: "journal",
            items: [
              {
                recordedAt: "2026-10-01T12:00:00Z",
                property: { outcome: "not_home", notes: "Household follow-up" },
                contactProcessing: { status: "ready" },
              },
            ],
            complete: true,
          }),
        }),
    );
    await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
    await expect(
      page.getByText("Household · Address not yet verified", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Not a texting recipient", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /42 Example Lane/ }).click();
    const dialog = page.getByRole("dialog", {
      name: "Contact details",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", { name: "42 Example Lane", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Address-only household", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(/This household cannot receive texts/),
    ).toBeVisible();
    await expect(dialog.locator('[name^="contact_"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Update districts", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", {
        name: "Remove source membership",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Review duplicate contacts", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Archive contact", exact: true }),
    ).toBeVisible();
    await dialog.getByText("Edit contact tags", { exact: true }).click();
    await dialog
      .getByRole("checkbox", { name: "Volunteer", exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Save contact", exact: true })
      .click();
    await expect
      .poll(
        () => fixture.calls.filter((call) => call.method === "PATCH").length,
      )
      .toBe(1);
    const saved = fixture.calls.find(
      (call) =>
        call.method === "PATCH" && call.path === `${BOOK}/contacts/contact-1`,
    );
    expect(saved.body.tags).toEqual(["tag-volunteer"]);
    expect(saved.body).not.toHaveProperty("fields");
    await dialog.getByText("Linked activity", { exact: true }).click();
    await dialog
      .getByRole("button", { name: "Address and unit journal", exact: true })
      .click();
    await expect(
      dialog.getByText("Notes: Household follow-up", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`household-${width}.png`),
      fullPage: true,
    });
    expect(fixture.errors).toEqual([]);
  });
}
