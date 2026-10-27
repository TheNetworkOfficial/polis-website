const { test, expect } = require("@playwright/test");
const {
  BASE_URL,
  COALITION_PATH,
  API,
  mockFieldworkWorkspace,
} = require("./fixtures/fieldwork-workspace.cjs");

const legacySelector = [
  ".shared-coalition-metrics",
  ".shared-coalition-voter-map-hero",
  ".shared-coalition-voter-map-menu",
  ".shared-coalition-browser-map",
].join(",");
const workspace = (page) => page.locator(".polis-field-work");

async function ready(page, { records = true } = {}) {
  await expect(workspace(page)).toBeVisible();
  await expect(workspace(page)).toHaveAttribute("aria-busy", "false");
  if (records)
    await expect(workspace(page).locator(".map-record").first()).toBeVisible();
}

async function assertCleanWorkspace(page) {
  const content = page.locator(".coalition-ui-content");
  await expect(
    content.getByRole("heading", { name: "Field work", exact: true }),
  ).toHaveCount(1);
  await expect(content.locator(legacySelector)).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__LEGACY_FIELDWORK_PANELS_SEEN__),
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth + 1));
  const selectedTab = await workspace(page)
    .locator('[role="tab"][aria-selected="true"]')
    .boundingBox();
  expect(selectedTab.x).toBeGreaterThanOrEqual(-1);
  expect(selectedTab.x + selectedTab.width).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth + 1),
  );
}

async function tab(page, name) {
  await workspace(page)
    .getByRole("tab", { name: new RegExp(`^${name}(?: \\d+)?$`, "i") })
    .click();
  await assertCleanWorkspace(page);
}

async function throughNavigation(page, mobile) {
  await page.goto(`${BASE_URL}/coalitions`);
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  if (mobile) {
    const menu = page.locator(".coalition-ui-mobile-nav");
    await menu.locator("summary").click();
    await menu.getByRole("button", { name: "Field work", exact: true }).click();
  } else
    await page
      .locator(".coalition-ui-sidebar")
      .getByRole("button", { name: "Field work", exact: true })
      .click();
  await ready(page);
}

for (const role of ["admin", "member"])
  for (const mobile of [false, true]) {
    test(`approved Field Work ${role} views match the full ${mobile ? "mobile" : "desktop"} workspace in both themes`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(120000);
      const fixture = await mockFieldworkWorkspace(page, { role });
      await page.setViewportSize(
        mobile ? { width: 390, height: 1000 } : { width: 1440, height: 1100 },
      );
      await throughNavigation(page, mobile);
      for (const theme of ["dark", "light"]) {
        await page.evaluate(
          (value) => localStorage.setItem("prefs.themeMode", value),
          theme,
        );
        await page.reload();
        await ready(page);
        for (const view of role === "admin"
          ? ["Map", "Territories", "Assignments"]
          : ["Map", "My areas"]) {
          await tab(page, view);
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: testInfo.outputPath(
              `${role}-${mobile ? "mobile" : "desktop"}-${theme}-${view.replaceAll(" ", "-")}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        }
      }
      if (role === "member") {
        await expect(
          workspace(page).getByRole("button", {
            name: "New territory",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          workspace(page).getByRole("tab", {
            name: "Assignments",
            exact: true,
          }),
        ).toHaveCount(0);
        expect(
          fixture.requests.filter((r) => r.path.endsWith("/assignments")),
        ).toEqual([]);
      }
      expect(fixture.unexpectedWrites).toEqual([]);
      expect(fixture.unauthenticatedRequests).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }

test("legacy field routes never insert the old dashboard or its duplicate tools", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  for (const suffix of [
    "",
    "/map",
    "/connected",
    "/add",
    "/notes?recordId=v1",
    "/territories/admin",
  ]) {
    await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map${suffix}`);
    await expect(workspace(page)).toBeVisible();
    await assertCleanWorkspace(page);
    if (await page.locator(".polis-field-work dialog[open]").count())
      await page.keyboard.press("Escape");
  }
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("the map reads voter points and keeps search, status, area and list views coherent", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await expect
    .poll(() =>
      fixture.requests.some((r) => r.path.endsWith("/voter-map/query")),
    )
    .toBe(true);
  expect(
    fixture.requests.some((r) => r.path.includes("/directory/map/query")),
  ).toBe(false);
  await expect(
    workspace(page)
      .locator(".map-legend")
      .getByText("Outreach remaining", { exact: true }),
  ).toBeVisible();
  await expect(
    workspace(page)
      .locator(".map-legend")
      .getByText("Reserved", { exact: true }),
  ).toBeVisible();
  await expect(
    workspace(page)
      .locator(".map-legend")
      .getByText("No pending outreach", { exact: true }),
  ).toBeVisible();
  await workspace(page).getByRole("searchbox").fill("Avery");
  await expect(workspace(page).locator(".map-record")).toHaveCount(1);
  await expect(workspace(page).locator(".map-record").first()).toContainText(
    "Avery Collins",
  );
  await workspace(page)
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await workspace(page)
    .getByRole("combobox", { name: "Outreach status", exact: true })
    .selectOption({ label: "Reserved" });
  await expect(workspace(page).locator(".map-record")).toHaveCount(3);
  await workspace(page)
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await workspace(page)
    .getByRole("button", { name: "List", exact: true })
    .click();
  await expect(workspace(page).locator(".field-table")).toBeVisible();
  await assertCleanWorkspace(page);
  expect(fixture.errors).toEqual([]);
});

test("member My areas comes from active assignment geometry, never the default map territory", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { role: "member" });
  // Put another person's territory first, proving defaultTerritoryId is not used.
  fixture.territories.reverse();
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await tab(page, "My areas");
  await expect(workspace(page).locator(".territory-card")).toHaveCount(1);
  await expect(workspace(page).locator(".territory-card")).toContainText(
    "North Cedar",
  );
  await expect(
    workspace(page).getByText("South Commons", { exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.requests.some(
      (r) =>
        r.path === "/api/voter-map/canvassing/progress" &&
        r.query.includes("coalitionId=cedar-valley"),
    ),
  ).toBe(true);
});

test("map/list failures are retriable errors and never valid empty results", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, {
    failList: true,
    failMap: true,
  });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page, { records: false });
  await expect(workspace(page).locator('[role="alert"]').first()).toBeVisible();
  await expect(
    workspace(page).getByRole("button", { name: /retry/i }).first(),
  ).toBeVisible();
  fixture.failList = false;
  fixture.failMap = false;
  await workspace(page).getByRole("button", { name: /retry/i }).first().click();
  await ready(page);
  await assertCleanWorkspace(page);
});

test("denied and genuinely empty data preserve the approved shell without unauthorized mutations", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { denied: true });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page, { records: false });
  await expect(workspace(page)).toContainText(/access|permission|authorized/i);
  await expect(
    workspace(page).getByRole("button", { name: "New territory", exact: true }),
  ).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  fixture.denied = false;
  fixture.voters = [];
  await page.reload();
  await ready(page, { records: false });
  await expect(workspace(page)).toContainText(
    /no voter|no records|no matching/i,
  );
  await assertCleanWorkspace(page);
});

test("notes preserve an unsent draft across drawer close and save errors, then clear only on success", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { failNote: true });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await expect(
    dialog.getByRole("heading", { name: "Avery Collins", exact: true }),
  ).toBeVisible();
  const note = "Keep this unsent field note <b>as plain text</b>";
  await dialog
    .getByRole("textbox", { name: "Add a note", exact: true })
    .fill(note);
  await page.keyboard.press("Escape");
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Add a note", exact: true }),
  ).toHaveValue(note);
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog.locator('[role="alert"]')).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Add a note", exact: true }),
  ).toHaveValue(note);
  fixture.failNote = false;
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "Add a note", exact: true }),
  ).toHaveValue("");
  await expect(dialog.getByText(note, { exact: true })).toBeVisible();
  await expect(dialog.locator("b")).toHaveCount(0);
  const writes = fixture.writes.filter((r) =>
    r.path.endsWith("/records/v1/notes"),
  );
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(
    expect.objectContaining({
      body: note,
      tags: [],
      contactType: expect.any(String),
    }),
  );
});

test("assignment management remains available when boundary authoring is unavailable", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { authoring: false });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await expect(
    workspace(page).getByRole("button", { name: "New territory", exact: true }),
  ).toHaveCount(0);
  await tab(page, "Assignments");
  await workspace(page)
    .getByRole("button", { name: /Manage Elmwood assignment/i })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await expect(
    dialog.getByRole("checkbox", { name: /Alex Morgan/ }),
  ).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Alex Morgan/ }).check();
  await dialog
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect
    .poll(() =>
      fixture.assignmentRows("elm").some((row) => row.userId === "alex"),
    )
    .toBe(true);
  expect(
    fixture.writes.some(
      (r) =>
        r.path === `${API}/voter-map/territories/elm/assignments` &&
        r.body.userId === "alex",
    ),
  ).toBe(true);
  await expect(
    workspace(page).locator('input:not([type="hidden"])[name="userId"]'),
  ).toHaveCount(0);
});

test("no assignment stays distinct from map access and offers the correct recovery destination", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, {
    role: "member",
    unassigned: true,
  });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page, { records: false });
  await tab(page, "My areas");
  await expect(workspace(page)).toContainText(/no.*assign|not.*assign/i);
  await expect(workspace(page).locator(".territory-card")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("voter list paging preserves earlier records and ignores late search responses", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { listPageSize: 4 });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .getByRole("button", { name: "List", exact: true })
    .click();
  await expect(workspace(page).locator("tbody tr")).toHaveCount(4);
  await workspace(page)
    .getByRole("button", { name: "Load more voters", exact: true })
    .click();
  await expect(workspace(page).locator("tbody tr")).toHaveCount(8);
  fixture.listDelayByQuery.taylor = 700;
  fixture.listDelayByQuery.avery = 10;
  await workspace(page).getByRole("searchbox").fill("Taylor");
  await expect
    .poll(() =>
      fixture.requests.some(
        (r) => r.path.endsWith("/voters") && r.query.includes("q=Taylor"),
      ),
    )
    .toBe(true);
  await workspace(page).getByRole("searchbox").fill("Avery");
  await expect
    .poll(() => fixture.completedListQueries.includes("avery"))
    .toBe(true);
  await expect
    .poll(() => fixture.completedListQueries.includes("taylor"))
    .toBe(true);
  await expect(workspace(page).locator("tbody tr")).toHaveCount(1);
  await expect(workspace(page).locator("tbody tr")).toContainText(
    "Avery Collins",
  );
});

test("manual voter creation preserves scope fields and requires an explicit duplicate choice", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  async function fillManual() {
    await workspace(page)
      .getByRole("button", { name: "Manage voter data", exact: true })
      .click();
    await page
      .locator(".polis-field-work dialog[open]")
      .getByRole("button", { name: "Add voter", exact: true })
      .click();
    const dialog = page.locator(".polis-field-work dialog[open]");
    await dialog
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Rowan Sample");
    await dialog
      .getByRole("textbox", { name: "Street address", exact: true })
      .fill("200 Sample Street");
    await dialog
      .getByRole("textbox", { name: "City", exact: true })
      .fill("Missoula");
    await dialog
      .getByRole("textbox", { name: "State", exact: true })
      .fill("MT");
    await dialog
      .getByRole("textbox", { name: "ZIP code", exact: true })
      .fill("59801");
    await dialog
      .getByRole("button", { name: "Add voter", exact: true })
      .click();
    return dialog;
  }
  await fillManual();
  await expect
    .poll(
      () =>
        fixture.voters.filter((v) => v.displayName === "Rowan Sample").length,
    )
    .toBe(1);
  const dialog = await fillManual();
  await expect(
    dialog.getByRole("button", { name: "Keep existing voter", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Keep existing voter", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    fixture.voters.filter((v) => v.displayName === "Rowan Sample"),
  ).toHaveLength(1);
  const writes = fixture.writes.filter((r) =>
    r.path.endsWith("/voters/manual"),
  );
  expect(writes.at(-1).body).toEqual(
    expect.objectContaining({
      name: "Rowan Sample",
      addressLine1: "200 Sample Street",
      city: "Missoula",
      state: "MT",
      postalCode: "59801",
      duplicateMode: "skip",
    }),
  );
  const replacement = await fillManual();
  await replacement
    .getByRole("button", { name: "Replace existing voter", exact: true })
    .click();
  await expect(replacement).toHaveCount(0);
  expect(
    fixture.writes.filter((r) => r.path.endsWith("/voters/manual")).at(-1).body
      .duplicateMode,
  ).toBe("replace");
  expect(
    fixture.voters.filter((v) => v.displayName === "Rowan Sample"),
  ).toHaveLength(1);
  fixture.manualOutOfScope = true;
  const outside = await fillManual();
  await expect(outside.locator('[role="alert"]')).toContainText(/scope/i);
  await expect(
    outside.getByRole("textbox", { name: "Street address", exact: true }),
  ).toHaveValue("200 Sample Street");
  expect(
    fixture.voters.filter((v) => v.displayName === "Rowan Sample"),
  ).toHaveLength(1);
});

test("CSV import previews recognized rows and duplicates before starting and exposes final status", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .getByRole("button", { name: "Manage voter data", exact: true })
    .click();
  let dialog = page.locator(".polis-field-work dialog[open]");
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  dialog = page.locator(".polis-field-work dialog[open]");
  const csv =
    "name,addressLine1,city,state,postalCode\nPeyton Clarke,156 Cedar Avenue,Missoula,MT,59801\n";
  await dialog.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "field-voters.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Review & match", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Duplicate records", exact: true }),
  ).toHaveValue("skip");
  await dialog
    .getByRole("combobox", { name: "Duplicate records", exact: true })
    .selectOption("replace");
  expect(
    fixture.writes.filter((r) => r.path === `${API}/voter-imports`),
  ).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Start import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import status", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText(/completed/i);
  expect(fixture.uploadedCsv).toBe(csv);
  expect(fixture.uploadHeaders.authorization).toBeUndefined();
  expect(
    fixture.writes.find((r) => r.path === `${API}/voter-imports`).body,
  ).toEqual({
    uploadId: "upload-fixture",
    duplicateMode: "replace",
    originalFileName: "field-voters.csv",
  });
});

test("the approved territory wizard uses current source, preview, draft and publish contracts", async ({
  page,
}, testInfo) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .getByRole("button", { name: "New territory", exact: true })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await dialog
    .getByRole("textbox", { name: "Plan name", exact: true })
    .fill("West Cedar");
  await dialog
    .getByRole("combobox", { name: "Source area", exact: true })
    .selectOption("0");
  await expect(
    dialog.getByRole("textbox", { name: "Plan name", exact: true }),
  ).toHaveValue("West Cedar");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await expect(
    dialog.getByRole("spinbutton", {
      name: "Number of territories",
      exact: true,
    }),
  ).toBeVisible({ timeout: 5000 });
  await dialog
    .getByRole("spinbutton", { name: "Number of territories", exact: true })
    .fill("2");
  await dialog
    .getByRole("button", { name: "Generate territories", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Selected territory", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => fixture.builderRevision).toBeGreaterThan(0);
  await dialog
    .getByRole("button", { name: "Review plan", exact: true })
    .click();
  const publish = dialog.getByRole("button", {
    name: "Publish territories",
    exact: true,
  });
  await expect(publish).toBeDisabled();
  for (const select of await dialog.locator("[data-fwb-assignee]").all())
    await select.selectOption("alex");
  await expect(publish).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("territory-wizard-review.png"),
    fullPage: true,
  });
  await publish.click();
  await expect(dialog).toHaveCount(0);
  const previews = fixture.writes.filter((r) =>
    r.path.endsWith("/territory-builder/preview"),
  );
  const published = fixture.writes.find((r) =>
    r.path.endsWith("/territory-builder/publish"),
  );
  expect(previews.length).toBeGreaterThanOrEqual(2);
  expect(published.body.territories).toHaveLength(2);
  expect(
    published.body.territories.every((t) => t.assigneeUserId === "alex"),
  ).toBe(true);
  expect(published.body.idempotencyKey).toBeTruthy();
  expect(fixture.unauthenticatedRequests).toEqual([]);
  expect(fixture.builderActorHeaders.length).toBeGreaterThan(0);
  expect(fixture.builderActorHeaders.every((actor) => actor === "alex")).toBe(
    true,
  );
  expect(published.body.contactExclusions).toEqual(
    expect.objectContaining({
      excludeDoNotKnock: true,
      excludeReportedDanger: true,
    }),
  );
  expect(
    fixture.requests.some((r) =>
      /district-unit-sets|generation-jobs/.test(r.path),
    ),
  ).toBe(false);
});

test("moved directory, event, transport and communication links preserve their data and context", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map/members?q=Jamie`);
  await expect(page).toHaveURL(
    `${BASE_URL}${COALITION_PATH}/members/directory?q=Jamie`,
  );
  await expect(
    page.getByText("Jamie External", { exact: true }).first(),
  ).toBeVisible();
  await expect(workspace(page)).toHaveCount(0);
  fixture.failDirectoryMembers = true;
  await page.reload();
  await expect(
    page.getByText("Directory list is temporarily unavailable", {
      exact: true,
    }),
  ).toBeVisible();
  fixture.failDirectoryMembers = false;
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map/cta?eventId=shift-1`);
  await expect(page).toHaveURL(
    `${BASE_URL}${COALITION_PATH}/calendar/field-events?eventId=shift-1`,
  );
  await expect(
    page.getByRole("heading", {
      name: "Cedar Valley canvass shift",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    fixture.requests.some(
      (r) =>
        r.path === "/api/events" &&
        r.query.includes("cursor=coalition-events-page-2"),
    ),
  ).toBe(true);
  await expect(workspace(page)).toHaveCount(0);
  await page.goto(
    `${BASE_URL}${COALITION_PATH}/voter-map/cta/transport/shift-1?tab=pickup`,
  );
  await expect(page).toHaveURL(
    `${BASE_URL}${COALITION_PATH}/calendar/field-events/transport?tab=pickup&eventId=shift-1`,
  );
  await expect
    .poll(() =>
      fixture.requests.some(
        (r) => r.path === `${API}/cta/events/shift-1/transport`,
      ),
    )
    .toBe(true);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map/scripts`);
  await expect(page).toHaveURL(
    `${BASE_URL}${COALITION_PATH}/admin/edit/outreach`,
  );
  await expect
    .poll(() =>
      fixture.requests.some(
        (r) => r.path === `${API}/voter-map/outreach-templates`,
      ),
    )
    .toBe(true);
  await expect(page.locator("textarea").first()).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("fresh permission denial prevents a note mutation while keeping the unsent text", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await dialog
    .getByRole("textbox", { name: "Add a note", exact: true })
    .fill("Keep this note after access changes");
  fixture.denied = true;
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    workspace(page).getByRole("heading", {
      name: "Field work access unavailable",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(workspace(page).locator(".map-record")).toHaveCount(0);
  expect(fixture.writes.filter((r) => r.path.endsWith("/notes"))).toHaveLength(
    0,
  );
  fixture.denied = false;
  await workspace(page)
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Add a note", exact: true }),
  ).toHaveValue("Keep this note after access changes");
});

test("changing an assigned team uses V2 revocation without changing coalition membership", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await tab(page, "Assignments");
  await workspace(page)
    .getByRole("button", { name: "Manage North Cedar assignment", exact: true })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await dialog.getByRole("checkbox", { name: /Jordan Lee/ }).uncheck();
  await dialog
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect
    .poll(() => fixture.assignmentRows("north").map((row) => row.userId))
    .toEqual(["alex"]);
  expect(fixture.writes).toContainEqual(
    expect.objectContaining({
      path: `${API}/voter-map/territories/north/assignments/north-jordan/revoke`,
      method: "POST",
      body: { userId: "jordan" },
    }),
  );
  expect(fixture.writes.some((r) => /\/members(?:\/|$)/.test(r.path))).toBe(
    false,
  );
});

test("clusters zoom into voter records and partial map results remain explicit", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, {
    cluster: true,
    partial: true,
  });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page, { records: false });
  const cluster = workspace(page).locator(".field-cluster-marker");
  await expect(cluster).toHaveCount(1);
  await expect(
    workspace(page).getByText(
      "Map results are partial. Zoom in for more detail.",
      { exact: true },
    ),
  ).toBeVisible();
  const queryCount = fixture.requests.filter((r) =>
    r.path.endsWith("/voter-map/query"),
  ).length;
  await cluster.click();
  await expect
    .poll(
      () =>
        fixture.requests.filter((r) => r.path.endsWith("/voter-map/query"))
          .length,
    )
    .toBeGreaterThan(queryCount);
  await expect(workspace(page).locator(".map-record").first()).toBeVisible();
  await expect(page.locator(".polis-field-work dialog[open]")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("the Doorknocker handoff uses the registered native coalition route", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { appScheme: "http" });
  let handoff;
  await page.route("http://auth/**", async (route) => {
    handoff = new URL(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<p>Captured native handoff</p>",
    });
  });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  await page
    .locator(".polis-field-work dialog[open]")
    .getByRole("button", { name: "Open in Doorknocker", exact: true })
    .click();
  await expect
    .poll(() => handoff?.searchParams.get("path"))
    .toBe(`${COALITION_PATH}/voter-map/door-knocker`);
  expect(fixture.writes).toEqual([]);
});

test("paused field work preserves map access and explains why visits cannot start", async ({
  page,
}) => {
  await mockFieldworkWorkspace(page, { paused: true });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await expect(
    workspace(page).getByText("Canvassing is paused", { exact: true }),
  ).toBeVisible();
  await expect(workspace(page).locator(".map-record").first()).toBeVisible();
  await assertCleanWorkspace(page);
});

test("an idle member map does not repeatedly query an unchanged viewport", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page, { role: "member" });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  // Let the initial fit animation complete, then observe a bounded idle window.
  await page.waitForTimeout(500);
  const count = () =>
    fixture.requests.filter((r) => r.path.endsWith("/voter-map/query")).length;
  const before = count();
  await page.waitForTimeout(1200);
  expect(count() - before).toBeLessThanOrEqual(1);
});

test("a partially saved assignment is reread before retrying instead of replaying successful writes", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await tab(page, "Assignments");
  await workspace(page)
    .getByRole("button", { name: "Manage Elmwood assignment", exact: true })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await dialog.getByRole("checkbox", { name: /Jordan Lee/ }).check();
  await dialog.getByRole("checkbox", { name: /Sam Rivera/ }).check();
  fixture.failAssignmentForUser = "sam";
  await dialog
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect(
    dialog.getByText("One assignment could not be saved", { exact: true }),
  ).toBeVisible();
  expect(fixture.assignments.elm).toEqual(["jordan"]);
  fixture.failAssignmentForUser = "";
  await dialog
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.assignments.elm).toEqual(["jordan", "sam"]);
  const creates = fixture.writes.filter(
    (r) => r.path === `${API}/voter-map/territories/elm/assignments`,
  );
  expect(creates.filter((r) => r.body.userId === "jordan")).toHaveLength(1);
  expect(creates.filter((r) => r.body.userId === "sam")).toHaveLength(2);
});

test("a shell refresh preserves the unsent note, focus and native modal state", async ({
  page,
}) => {
  await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  const textbox = dialog.getByRole("textbox", {
    name: "Add a note",
    exact: true,
  });
  await textbox.fill("Unsent note through a workspace refresh");
  await page.evaluate(() => {
    window.__previousFieldHeading = document.querySelector(
      ".coalition-ui-heading",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect
    .poll(() => page.evaluate(() => !window.__previousFieldHeading.isConnected))
    .toBe(true);
  await expect(textbox).toHaveValue("Unsent note through a workspace refresh");
  await expect
    .poll(() => dialog.evaluate((node) => node.matches(":modal")))
    .toBe(true);
  await expect(textbox).toBeFocused();
});

test("a paused member sees the paused state before the unavailable My areas list", async ({
  page,
}) => {
  await mockFieldworkWorkspace(page, { role: "member", paused: true });
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page, { records: false });
  await expect(
    workspace(page).getByText("Canvassing is paused", { exact: true }),
  ).toBeVisible();
  await expect(
    workspace(page).getByRole("button", { name: "New territory", exact: true }),
  ).toHaveCount(0);
});

test("rotating the same member's credentials reloads access and preserves only the unsent note", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  const note = "Unsent note while my credentials refresh";
  await dialog
    .getByRole("textbox", { name: "Add a note", exact: true })
    .fill(note);
  await page.keyboard.press("Escape");
  const accessReads = () =>
    fixture.requests.filter((r) => r.path.endsWith("/voter-map/access")).length;
  const previousReads = accessReads();
  await page.evaluate(() => {
    const key = "sharedFeedSession.v1";
    const session = JSON.parse(sessionStorage.getItem(key));
    const parts = session.idToken.split(".");
    const claims = JSON.parse(atob(parts[1]));
    claims.credentialVersion = "refreshed-for-field-work";
    const token = `${parts[0]}.${btoa(JSON.stringify(claims))}.refreshed`;
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...session, idToken: token, accessToken: token }),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await workspace(page)
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect.poll(accessReads).toBeGreaterThan(previousReads);
  await ready(page);
  await workspace(page)
    .locator(".map-record")
    .filter({ hasText: "Avery Collins" })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Add a note", exact: true }),
  ).toHaveValue(note);
  expect(
    fixture.writes.filter((r) => r.path.endsWith("/records/v1/notes")),
  ).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("household pins expose partial results and recover from independent load errors", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  fixture.householdMapEnabled = true;
  fixture.households = [
    {
      kind: "household",
      contactId: "household-fixture",
      lat: 46.863,
      lng: -114.006,
      address: { addressLine1: "100 Fixture Lane" },
      reviewRequired: true,
    },
  ];
  fixture.partialHouseholds = true;
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await expect(
    workspace(page).getByRole("button", {
      name: "Household: 100 Fixture Lane, needs review",
      exact: true,
    }),
  ).toBeVisible();
  await expect(workspace(page).locator("[data-fw-count]")).toContainText(
    "Household address results are partial",
  );
  fixture.failHouseholds = true;
  await workspace(page)
    .getByRole("button", { name: "Refresh household addresses", exact: true })
    .click();
  await expect(workspace(page).locator("[data-fw-count]")).toContainText(
    "Household addresses could not be loaded",
  );
  await expect(workspace(page).locator(".field-household-marker")).toHaveCount(
    0,
  );
  await expect(workspace(page).locator(".map-record").first()).toBeVisible();
  fixture.failHouseholds = false;
  fixture.partialHouseholds = false;
  await workspace(page)
    .getByRole("button", { name: "Refresh household addresses", exact: true })
    .click();
  await expect(workspace(page).locator(".field-household-marker")).toHaveCount(
    1,
  );
  await expect(
    workspace(page).getByRole("button", {
      name: "Refresh household addresses",
      exact: true,
    }),
  ).toBeHidden();
  expect(fixture.errors).toEqual([]);
});

test("disabled household layer leaves ordinary voter pins and list available without a retry warning", async ({
  page,
}) => {
  const fixture = await mockFieldworkWorkspace(page);
  fixture.failHouseholds = true;
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  await ready(page);
  await expect(workspace(page).locator(".map-record").first()).toBeVisible();
  await expect(
    workspace(page).getByText(
      "Household addresses could not be loaded. Retry the map.",
      { exact: true },
    ),
  ).toHaveCount(0);
  expect(
    fixture.requests.filter((request) =>
      request.path.endsWith("/household-map"),
    ),
  ).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
