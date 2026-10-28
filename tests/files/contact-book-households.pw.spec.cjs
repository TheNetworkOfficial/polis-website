const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK } = require("./contact-book-fixture.cjs");

for (const width of [1280, 390]) {
  test(`household completion and shared history at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let completed = false;
    const household = {
      contactId: "household-completion",
      recordKind: "household",
      revision: 2,
      status: "active",
      fields: {
        addressLine1: "100 Example Street",
        city: "Helena",
        state: "MT",
        postalCode: "59601",
        addressResolution: { status: "verified" },
      },
      tags: [],
    };
    const person = {
      contactId: "named-completion",
      revision: 1,
      status: "active",
      fields: { ...household.fields, displayName: "Alex Example" },
      tags: [],
    };
    const fixture = await mockBook(page, {
      capabilities: { householdContacts: true },
      configureFixture({ rows }) {
        rows.splice(0, rows.length, household);
      },
      queryResponse(body) {
        const items = completed
          ? body.includeLinkedHouseholds
            ? [household, person]
            : [person]
          : [household];
        return {
          items,
          complete: true,
          total: items.length,
          bookRevision: completed ? 3 : 2,
        };
      },
    });
    await page.route(
      "**/api/contact-book/scopes/*/contacts/**",
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        const respond = (body) =>
          route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ ok: true, ...body }),
          });
        if (
          route.request().method() === "POST" &&
          path.endsWith("/household-completion")
        ) {
          completed = true;
          return respond({ contact: person, household });
        }
        if (path.endsWith("/activity"))
          return respond({
            kind: "journal",
            items: [
              {
                recordedAt: "2026-10-28T12:00:00Z",
                property: {
                  outcome: "not_home",
                  notes: "Property observation stays at this address",
                },
                contactProcessing: { status: "ready" },
              },
            ],
            complete: true,
          });
        const current = path.endsWith(person.contactId) ? person : household;
        return respond({
          contact: current,
          history: [],
          sources: [],
          relationships: {
            enabled: true,
            complete: true,
            households: current.recordKind === "household" ? [] : [household],
            people:
              current.recordKind === "household" && completed ? [person] : [],
          },
        });
      },
    );
    await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
    await page
      .getByRole("button", { name: /100 Example Street.*Household/ })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Contact details",
      exact: true,
    });
    await dialog
      .getByLabel("Person's name (optional)", { exact: true })
      .fill("Alex Example");
    await dialog
      .getByRole("button", { name: "Save contact details", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Alex Example", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", {
        name: "Household and property history",
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "View household history", exact: true })
      .click();
    await expect(
      dialog.getByText(/Property observation stays at this address/),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Alex Example", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`household-completion-${width}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByText("1 matching contacts", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /100 Example Street.*Household/ }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "More contact tools", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Show completed household records",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("2 matching contacts", { exact: true }),
    ).toBeVisible();
    expect(fixture.errors).toEqual([]);
  });
}

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
