const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { mockBook, BASE } = require("./contact-book-fixture.cjs");
const artifacts =
  process.env.POLIS_BALLOT_TEST_ARTIFACTS ||
  "D:/CodexHome/artifacts/polis-ballot-register-20261015/website/output/playwright";
const schema = [
  {
    fieldId: "displayName",
    label: "Name",
    type: "text",
    sortable: true,
    filterable: true,
  },
  {
    fieldId: "precinct",
    label: "Precinct",
    type: "text",
    sortable: true,
    filterable: true,
  },
  {
    fieldId: "city",
    label: "City",
    type: "text",
    sortable: true,
    filterable: true,
  },
  {
    fieldId: "source_Party",
    label: "County party",
    type: "text",
    sortable: true,
    filterable: true,
    sourceColumn: "Party",
  },
  {
    fieldId: "ballotStatus",
    label: "Ballot status",
    type: "text",
    sortable: true,
    filterable: true,
  },
];
const statuses = {
  outstanding: ["requested", "issued", "issued"],
  newly_returned: ["returned", "accepted", "returned"],
  returned: ["returned", "accepted", "cure_required"],
  needs_followup: ["cure_required", "rejected", "unknown"],
  all: ["issued", "accepted", "cure_required"],
};
async function openRegister(
  page,
  { scopeType = "coalition", capabilities = {} } = {},
) {
  const fixture = await mockBook(page, {
    scopeType,
    capabilities: { ballotChaser: true, ...capabilities },
  });
  const calls = [],
    control = { stale: false },
    source = `/api/contact-book/scopes/${encodeURIComponent(`${scopeType}:org-1`)}/ballot-chaser`;
  const election = {
    electionId: "register-general",
    name: "County general election",
    state: "MT",
    county: "Fictional County",
    storageMode: "register",
    revision: 1,
    activeSnapshotId: "snapshot-one",
    sourcePolicy: { permittedPurpose: "not_for_sms" },
  };
  const imported = {
    importId: "register-import",
    electionId: election.electionId,
    fileName: "County baseline.csv",
    status: "complete",
    sourceAsOf: "2026-10-15T16:00:00Z",
    counts: {
      rows: 500000,
      newContacts: 0,
      updatedContacts: 0,
      newVoters: 500000,
      updatedVoters: 0,
      unchanged: 0,
      duplicateRows: 0,
      conflicts: 0,
    },
  };
  let lastView = "outstanding";
  await page.route("**/ballot-chaser/**", async (route) => {
    const request = route.request(),
      suffix = new URL(request.url()).pathname.slice(source.length),
      body = request.postData() ? request.postDataJSON() : null;
    calls.push({ suffix, method: request.method(), body });
    const respond = (data) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...data }),
      });
    if (suffix === "/elections") return respond({ items: [election] });
    if (suffix === "/elections/register-general") return respond({ election });
    if (suffix === "/elections/register-general/dashboard")
      return respond({
        dashboard: {
          snapshotId: control.stale ? "snapshot-two" : "snapshot-one",
          total: 500000,
          outstanding: 300000,
          returned: 200000,
          accepted: 170000,
          needsFollowup: 10000,
          newlyReturned: 15000,
          sourceAsOf: "2026-10-15T16:00:00Z",
          previousSourceAsOf: "2026-10-14T16:00:00Z",
        },
      });
    if (suffix.startsWith("/imports"))
      return respond(
        suffix === "/imports/register-import"
          ? { import: imported }
          : { items: [imported] },
      );
    if (suffix.endsWith("/voters")) {
      if (control.stale && body.snapshotId !== "snapshot-two")
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "ballot_snapshot_changed" }),
        });
      lastView = body.view;
      const names = ["Alex Example", "Blair Example", "Casey Example"];
      const rows = names.map((name, index) => ({
        voterRef: `voter-ref-${index + 1}`,
        voterId: `0000${index + 1}`,
        contactId: index === 1 ? "existing-contact" : null,
        fields: {
          displayName: name,
          precinct: index < 2 ? "Canary East" : "Canary West",
          city: "Example City",
          source_Party: "Independent",
        },
        ballotState: {
          status: statuses[body.view][index],
          sourceAsOf: "2026-10-15T16:00:00Z",
        },
      }));
      const filtered = body.filter || body.search ? rows.slice(0, 2) : rows;
      return respond({
        storageMode: "register",
        schema,
        items: body.cursor ? filtered.slice(2) : filtered.slice(0, 2),
        nextCursor: !body.cursor && filtered.length > 2 ? "page-two" : null,
        complete: !!body.cursor || filtered.length < 3,
        total:
          body.filter || body.search
            ? 2
            : {
                outstanding: 300000,
                newly_returned: 15000,
                returned: 200000,
                needs_followup: 10000,
                all: 500000,
              }[body.view],
        ballotChase: {
          electionId: election.electionId,
          snapshotId: body.snapshotId,
          view: body.view,
          sourceAsOf: "2026-10-15T16:00:00Z",
        },
      });
    }
    if (suffix.endsWith("/contacts"))
      return respond({
        job: {
          jobId: "add-selected",
          status: "queued",
          total: body.voterRefs.length,
          processed: 0,
          added: 0,
          linked: 0,
          reviewRequired: 0,
        },
      });
    if (suffix.endsWith("/contacts/add-selected"))
      return respond({
        job: {
          jobId: "add-selected",
          status: "complete",
          total: 1,
          processed: 1,
          added: 1,
          linked: 0,
          reviewRequired: 0,
        },
      });
    if (suffix.endsWith("/exports") || suffix === "/exports/export-one")
      return respond({
        export: {
          exportId: "export-one",
          status: request.method() === "POST" ? "building" : "ready",
          rows: 2,
          snapshotId: body?.snapshotId || "snapshot-one",
          view: body?.view || lastView,
        },
        ...(request.method() === "GET"
          ? {
              download: {
                method: "GET",
                url: "https://fixture-private.s3.us-west-2.amazonaws.com/register.csv",
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            }
          : {}),
      });
    return route.fulfill({
      status: 404,
      body: JSON.stringify({ error: "unexpected_register_request" }),
    });
  });
  await page.route(
    "https://fixture-private.s3.us-west-2.amazonaws.com/**",
    (route) =>
      route.fulfill({
        contentType: "text/csv",
        headers: {
          "Content-Disposition": 'attachment; filename="ballot-voters.csv"',
        },
        body: "Name,Ballot status\nAlex Example,accepted\n",
      }),
  );
  await page.goto(`${BASE}/workspace/${scopeType}/org-1/work/ballot-chaser`);
  await expect(
    page.getByRole("heading", { name: "Ballot Chaser", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show ballots not returned", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "County voter list" }),
  ).toBeVisible();
  await expect(
    page.getByText("Alex Example", { exact: true }).first(),
  ).toBeVisible();
  return { ...fixture, bookCalls: fixture.calls, calls, control };
}

test("register lists all five views with real county status and no canonical queries", async ({
  page,
}) => {
  const fixture = await openRegister(page);
  for (const [view, title] of Object.entries({
    outstanding: "Outstanding",
    newly_returned: "Newly returned",
    returned: "Returned",
    needs_followup: "Needs follow-up",
    all: "All voters",
  })) {
    await page.getByLabel("Ballot list", { exact: true }).selectOption(view);
    await page.getByRole("button", { name: "Open list", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    if (view === "newly_returned") {
      await expect(page.locator("[data-ballot-key]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page.screenshot({
        path: path.join(artifacts, "register-newly-returned-wide.png"),
        fullPage: true,
      });
    }
    await expect(
      page
        .getByRole("cell", {
          name: {
            requested: "Requested",
            returned: "Returned",
            cure_required: "Needs cure",
            issued: "Issued / not returned",
          }[statuses[view][0]],
          exact: true,
        })
        .first(),
    ).toBeVisible();
  }
  expect(
    fixture.calls.filter((call) => call.suffix.endsWith("/contacts")),
  ).toEqual([]);
  expect(
    fixture.calls
      .filter((call) => call.suffix.endsWith("/voters"))
      .every((call) => call.body.snapshotId === "snapshot-one"),
  ).toBeTruthy();
  expect(
    fixture.calls.some((call) => call.suffix.includes("/selections")),
  ).toBeFalsy();
  expect(
    fixture.bookCalls.some((call) =>
      /\/(query|selections|contacts)$/.test(call.path),
    ),
  ).toBeFalsy();
  expect(fixture.errors).toEqual([]);
});

test("search, source columns and grouped filters stay on the register; all matching export preserves query", async ({
  page,
}) => {
  const fixture = await openRegister(page);
  await page.getByLabel("Search voters", { exact: true }).fill("Example");
  await page
    .getByLabel("Sort by", { exact: true })
    .selectOption("displayName:desc");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect
    .poll(
      () =>
        fixture.calls.filter((call) => call.suffix.endsWith("/voters")).at(-1)
          .body.search,
    )
    .toBe("Example");
  await page.getByText("Filters", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page.getByLabel("Field", { exact: true }).selectOption("precinct");
  await page.getByLabel("Value", { exact: true }).fill("Canary East");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixture.calls.filter((call) => call.suffix.endsWith("/voters")).at(-1)
          .body.filter?.conditions[0]?.value,
    )
    .toBe("Canary East");
  await page.getByText("Columns", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "County party", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Select all matching", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Select Blair Example", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Select Blair Example", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Export selected voters", exact: true })
    .click();
  const exported = fixture.calls.find((call) =>
    call.suffix.endsWith("/exports"),
  );
  expect(exported.body.selection).toEqual({
    mode: "all_matching",
    excludeVoterRefs: ["voter-ref-2"],
  });
  expect(exported.body.filter.conditions[0].field).toBe("precinct");
  expect(exported.body.sort).toEqual({
    field: "displayName",
    direction: "desc",
  });
  expect(exported.body.columns).toContain("source_Party");
  expect(exported.body.columns).toContain("ballotStatus");
  await expect(
    page.getByText("Preparing your CSV", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-ballot-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: path.join(artifacts, "register-export-wide.png"),
    fullPage: true,
  });
});

test("explicit Add to Contact Book creates only selected voter references and polls its job", async ({
  page,
}) => {
  const fixture = await openRegister(page);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Add selected to Contact Book", exact: true })
    .click();
  await expect(
    page.getByText("Adding selected voters", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check Contact Book progress", exact: true })
    .click();
  await expect(
    page.getByText("Contact Book updated", { exact: true }),
  ).toBeVisible();
  const calls = fixture.calls.filter((call) =>
    call.suffix.endsWith("/contacts"),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].body.voterRefs).toEqual(["voter-ref-1"]);
  expect(calls[0].body.snapshotId).toBe("snapshot-one");
});

test("stale generation drops selected rows and requires a fresh list", async ({
  page,
}) => {
  const fixture = await openRegister(page);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  fixture.control.stale = true;
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByText("Refresh this list", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Alex Example", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export selected voters", exact: true }),
  ).toHaveCount(0);
});

test("candidate phone register shows county details and exports without creating a contact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await openRegister(page, {
    scopeType: "candidate",
    capabilities: { import: false, manage: false },
  });
  await page
    .getByLabel("Ballot list", { exact: true })
    .selectOption("newly_returned");
  await page.getByRole("button", { name: "Open list", exact: true }).click();
  await page
    .getByRole("button", { name: "County details", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("definition").filter({ hasText: "Independent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Add selected to Contact Book",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("[data-ballot-key]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.join(artifacts, "register-newly-returned-phone.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Export selected voters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check progress", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  const exported = fixture.calls.find((call) =>
    call.suffix.endsWith("/exports"),
  );
  expect(exported.body.selection).toEqual({
    mode: "explicit",
    includeVoterRefs: ["voter-ref-1"],
  });
  expect(exported.body.sort).toBeUndefined();
  expect(fixture.errors).toEqual([]);
});

test("register import summary counts county voters without claiming canonical contact creation", async ({
  page,
}) => {
  await openRegister(page);
  await page
    .getByRole("button", { name: "Back to ballot progress", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View outcomes", exact: true })
    .click();
  await expect(page.getByText(/500,000 records added/)).toBeVisible();
  await expect(page.getByText(/0 new people/)).toHaveCount(0);
});
