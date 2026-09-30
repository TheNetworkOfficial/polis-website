const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const BOOK = "/api/contact-book/scopes/coalition%3Aorg-1";
const PROMPT = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

async function mockBook(
  page,
  { resume = false, duplicate = false, issues = false, recovery = false } = {},
) {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "contact-admin", email: "admin@example.test" })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ baseUrl, token }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: Date.now() + 3600000,
        }),
      );
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: baseUrl,
            auth: {
              ...value.auth,
              region: "us-west-2",
              clientId: "test",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { baseUrl: BASE, token },
  );
  const calls = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fields = [
    ["displayName", "Name"],
    ["firstName", "First name"],
    ["phone", "Phone"],
    ["city", "City"],
    ["state", "State"],
    ["consentStatus", "Opt-in status"],
    ["stateHouseDistrict", "State House district"],
    ["taxDistrict", "Special tax district"],
    ["doorKnock", "Door knock"],
    ["addresses", "Additional addresses"],
  ].map(([fieldId, label]) => ({
    fieldId,
    label,
    type:
      fieldId === "doorKnock"
        ? "boolean"
        : fieldId === "addresses"
          ? "json"
          : "text",
    group: "Identity",
    custom: fieldId === "taxDistrict",
    filterable: true,
    sortable: true,
  }));
  const rows = ["Alex Example", "Blair Example", "Casey Example"].map(
    (name, index) => ({
      contactId: `contact-${index + 1}`,
      scopeKey: "coalition:org-1",
      revision: 1,
      fields: {
        displayName: name,
        phone: `+1202555012${index + 1}`,
        city: "Example City",
        state: "MT",
        stateHouseDistrict: "22",
        consentStatus: "opted_in",
        taxDistrict: "0007",
        addresses: [
          {
            line1: "12 Fictional Lane",
            unit: "0002",
            custom: { tax: "0007", visited: false },
          },
        ],
        ...(issues ? { doorKnock: "sometimes" } : {}),
      },
      fieldIssues: issues
        ? { doorKnock: { code: "invalid_type", expectedType: "boolean" } }
        : {},
      tags: [],
      sources: [
        {
          sourceId: `source-${index + 1}`,
          sourceRecordId: `record-${index + 1}`,
          label: `List ${index + 1}`,
        },
      ],
      eligibility: { status: "eligible", reasons: [] },
      sync: {
        status: "updating_related_views",
        acceptedRevision: 1,
        indexRevision: 1,
        mapRevision: 0,
      },
    }),
  );
  let selection,
    campaign,
    imported = false,
    conversion,
    geographyJob,
    bulkJob;
  const tags = [{ tagId: "tag-volunteer", label: "Volunteer", revision: 1 }];
  const views = [];
  const viewDefaults = { viewId: null, revision: 0 };
  let schemaJob = recovery ? "convert-1" : null;
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== BASE) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname,
      body = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ path, method: request.method(), body });
    const respond = (data) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...data }),
      });
    if (path.startsWith(BOOK)) {
      const suffix = path.slice(BOOK.length);
      if (suffix === "/schema")
        return respond({
          fields,
          viewDefaults,
          tags,
          sources: rows.map((row, index) => ({
            sourceId: `source-${index + 1}`,
            label: `List ${index + 1}`,
          })),
          capabilities: {
            read: true,
            edit: true,
            manage: true,
            import: true,
            export: true,
            select: true,
            personal: true,
          },
          privacy: {
            externalGeocoding: false,
            automaticExternalSharing: false,
          },
        });
      if (suffix === "/tags/tag-volunteer" && request.method() === "PATCH") {
        Object.assign(tags[0], body, { revision: tags[0].revision + 1 });
        return respond({ tag: tags[0] });
      }
      if (suffix === "/views") {
        if (request.method() === "POST") {
          const view = { ...body, viewId: "view-1", revision: 1 };
          views.push(view);
          return respond({ view });
        }
        return respond({ items: views.filter((view) => !view.archived) });
      }
      if (suffix === "/views/view-1" && request.method() === "PATCH") {
        Object.assign(views[0], body, { revision: views[0].revision + 1 });
        return respond({ view: views[0] });
      }
      if (suffix === "/view-default") {
        Object.assign(viewDefaults, {
          viewId: body.viewId,
          revision: viewDefaults.revision + 1,
        });
        return respond({ viewDefaults });
      }
      if (suffix === "/import-preview")
        return respond({
          preview: {
            sampleOnly: true,
            sampledRows: body.rows.length,
            newContacts: 1,
            matchedContacts: 0,
            conflicts: 0,
            missingLocations: 1,
            invalidPhones: 0,
            customFields: [{ label: "Unfamiliar column" }],
            rows: [{ row: 0, status: "new", missingLocation: true }],
            bookRevision: 7,
          },
        });
      if (suffix === "/imports/import-1/rows/0/original")
        return respond({
          row: 0,
          columns: ["Name", "Special tax district"],
          values: ["Source Example", "0008"],
        });
      if (suffix.startsWith("/contacts/contact-1/activity"))
        return respond({
          kind: "requests",
          items: [
            {
              type: "yard_sign",
              status: "fulfilled",
              propertyId: "property-1",
            },
          ],
          nextCursor: null,
          complete: true,
          basis: "authorized_contact_activity",
        });
      if (suffix === "/audiences") return respond({ items: [] });
      if (suffix === "/query")
        return respond({
          items: body?.cursor ? rows.slice(2) : rows.slice(0, 2),
          nextCursor: body?.cursor ? null : "page-2",
          complete: !!body?.cursor,
          total: 3,
          bookRevision: 7,
        });
      if (suffix === "/imports" && request.method() === "GET")
        return respond({
          items: resume
            ? [
                {
                  importId: "import-1",
                  name: "interrupted.csv",
                  status: "open",
                  accepted: 1,
                  conflicts: 0,
                },
              ]
            : imported
              ? [
                  {
                    importId: "import-1",
                    name: "example.csv",
                    status: "complete",
                  },
                ]
              : [],
        });
      if (suffix === "/imports/import-1" && request.method() === "GET")
        return respond({
          import: {
            importId: "import-1",
            name: "interrupted.csv",
            status: "open",
            columns: ["Name", "Special tax district"],
            fieldByIndex: { 0: "displayName", 1: "taxDistrict" },
            sourceNamespace: "example-voter-2026",
            sourcePolicy: { permittedPurpose: "not_for_sms" },
            accepted: 1,
            conflicts: 0,
          },
        });
      if (suffix === "/imports" && request.method() === "POST")
        return respond({
          import: { importId: "import-1", status: "importing" },
        });
      if (suffix === "/imports/import-1/rows" && request.method() === "GET")
        return respond({
          items: [
            { row: 0, status: "accepted", contactId: "contact-1" },
            {
              row: 1,
              status: "conflict",
              error: "contact_identity_review_required",
            },
          ],
          nextCursor: null,
        });
      if (suffix === "/imports/import-1/rows")
        return respond({
          import: { importId: "import-1" },
          accepted: body.rows.length,
          processedRows: body.rows.length,
          nextRow: body.startRow + body.rows.length,
          remainingRows: 0,
          complete: true,
        });
      if (suffix === "/imports/import-1/complete") {
        imported = true;
        return respond({
          import: { importId: "import-1", status: "complete" },
        });
      }
      if (suffix === "/selections") {
        selection = {
          selectionId: "selection-1",
          status: "ready",
          count: 2,
          eligibleCount: 2,
          excludedCount: 0,
          duplicateEndpointCount: duplicate ? 1 : 0,
          duplicateEndpoints: duplicate
            ? [{ contactIds: ["contact-1", "contact-3"] }]
            : [],
          bookRevision: 7,
        };
        return respond({ selection });
      }
      if (suffix === "/selections/selection-1/contacts")
        return respond({ items: [rows[0], rows[2]], nextCursor: null });
      if (suffix === "/selections/selection-1/campaign")
        return respond({
          audienceId: "contactbook:selection-1",
          selectionId: "selection-1",
          exportAuthorized: false,
        });
      if (suffix === "/fields/taxDistrict/conversions") {
        conversion = {
          jobId: "convert-1",
          status: "preview_ready",
          processed: 3,
          invalid: 0,
          samples: [{ before: "0007", after: 7 }],
        };
        return respond({ job: conversion });
      }
      if (suffix === "/conversions/convert-1/apply")
        return respond({ job: { ...conversion, status: "applying" } });
      if (suffix === "/conversions/convert-1/advance") {
        schemaJob = null;
        return respond({ job: { ...conversion, status: "complete" } });
      }
      if (suffix === "/schema-job/recover") {
        conversion = {
          jobId: "convert-1",
          fieldId: "taxDistrict",
          status: "applying",
          processed: 1,
        };
        return respond({ job: conversion });
      }
      if (suffix === "/contacts/contact-1/enrich")
        return respond({
          contact: rows[0],
          status: "local_address_coverage_unavailable",
          externalRequests: 0,
        });
      if (suffix === "/geography-refresh") {
        geographyJob = {
          jobId: "geography-1",
          status: "previewing",
          processed: 0,
          changedCount: 0,
        };
        return respond({ job: geographyJob });
      }
      if (suffix === "/geography-refresh/geography-1/advance") {
        geographyJob = {
          ...geographyJob,
          status:
            geographyJob.status === "applying" ? "complete" : "preview_ready",
          processed: 2,
          changedCount: 1,
        };
        return respond({ job: geographyJob });
      }
      if (suffix === "/geography-refresh/geography-1/apply") {
        geographyJob.status = "applying";
        return respond({ job: geographyJob });
      }
      if (suffix.startsWith("/geography-refresh/geography-1/outcomes"))
        return respond({
          items: [
            {
              contactId: "contact-1",
              status: "matched",
              geographyStatus: "local_address_coverage_unavailable",
              before: [],
              after: [],
            },
          ],
          nextCursor: null,
        });
      if (suffix.startsWith("/geography-refresh/geography-1/affected-views"))
        return respond({
          items: [{ name: "House district audience" }],
          nextCursor: null,
        });
      if (suffix === "/bulk") {
        bulkJob = {
          jobId: "bulk-1",
          action: body.action,
          status: "running",
          processed: 0,
        };
        return respond({ job: bulkJob });
      }
      if (suffix === "/jobs/bulk-1/advance") {
        bulkJob = {
          ...bulkJob,
          status: bulkJob.phase === "undo" ? "undone" : "complete",
          processed: 2,
        };
        return respond({ job: bulkJob });
      }
      if (suffix === "/jobs/bulk-1/outcomes")
        return respond({
          items: [
            {
              contactId: "contact-1",
              status: bulkJob.phase === "undo" ? "undone" : "applied",
              ...(bulkJob.action === "enrich"
                ? { geographyStatus: "local_address_coverage_unavailable" }
                : {}),
            },
          ],
          nextCursor: null,
        });
      if (suffix === "/jobs/bulk-1/undo") {
        bulkJob = { ...bulkJob, phase: "undo", status: "running" };
        return respond({ job: bulkJob });
      }
      if (suffix === "/status")
        return respond({
          bookRevision: 7,
          schemaJob,
          pendingIndexes: 0,
          pendingRestrictions: 1,
          externalSharing: false,
        });
      if (suffix === "/reconcile")
        return respond({
          processed: 2,
          repaired: 0,
          mapRepaired: 2,
          failures: [],
          complete: true,
          nextCursor: null,
        });
      if (suffix === "/contacts/contact-1/sources/remove") {
        rows[0].sources = [];
        rows[0].revision++;
        return respond({ contact: rows[0] });
      }
      if (suffix === "/identities/merge") {
        Object.assign(rows[0].fields, body.fieldChoices || {});
        rows[0].revision++;
        return respond({ contact: rows[0], mergeId: "merge-1" });
      }
      if (suffix.startsWith("/contacts/")) {
        const row = rows.find((row) => `/contacts/${row.contactId}` === suffix);
        if (request.method() === "PATCH") {
          Object.assign(row.fields, body.fields || {});
          row.tags = body.tags || row.tags;
          row.revision++;
        }
        return respond({ contact: row, history: [], sources: row.sources });
      }
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "unexpected_book_endpoint" }),
      });
    }
    if (path.startsWith(PROMPT)) {
      const suffix = path.slice(PROMPT.length);
      if (suffix === "/workspace")
        return respond({
          workspace: {
            provider: "prompt",
            scopeKey: "coalition:org-1",
            manualOnly: true,
            status: "configured",
            canSend: true,
            capabilities: {
              manageBilling: true,
              createCampaigns: true,
              uploadImports: true,
            },
          },
        });
      if (suffix === "/billing/summary")
        return respond({
          billing: {
            canManageBilling: true,
            rateStatus: "verified",
            smsUpToTwoSegmentsMicros: 35000,
            availableMicros: 1000000,
            sendingBlocked: false,
          },
        });
      if (suffix === "/delivery-schedule")
        return respond({
          schedule: {
            revision: 1,
            status: "verified",
            timeZone: "America/Denver",
            startTime: "08:00",
            endTime: "20:00",
          },
        });
      if (suffix === "/campaigns" && request.method() === "POST") {
        campaign = {
          ...body,
          revision: 1,
          status: "draft",
          assignedUserIds: [],
          blockedReasons: [],
        };
        return respond({ campaign });
      }
      if (suffix.startsWith("/campaigns/") && request.method() === "GET")
        return respond({ campaign });
      return respond({ items: [] });
    }
    return respond({});
  });
  return { calls, errors };
}

test("shared contact book works without provider setup, retains custom columns, and edits a shared contact", async ({
  page,
}, testInfo) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
  expect(calls.some((call) => call.path.startsWith(PROMPT))).toBe(false);
  await page.getByText("View and saved audiences", { exact: true }).click();
  await page.getByLabel("Special tax district", { exact: true }).check();
  await expect(
    page.getByRole("columnheader", { name: "Special tax district" }),
  ).toBeVisible();
  await page.getByLabel("Tag: Volunteer", { exact: true }).check();
  await page.getByLabel("Volunteer for Alex Example", { exact: true }).check();
  await expect
    .poll(() => calls.filter((call) => call.method === "PATCH").length)
    .toBe(1);
  expect(calls.find((call) => call.method === "PATCH").body.tags).toEqual([
    "tag-volunteer",
  ]);
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
  await page.getByText("View and saved audiences", { exact: true }).click();
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

test("campaign selection covers all pages, preserves exclusions, and binds locally before any provider preparation", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/new`);
  await expect(
    page.getByRole("heading", { name: "Choose campaign recipients" }),
  ).toBeVisible();
  await page.getByText("Filter contacts", { exact: true }).click();
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
    page.getByText("Contacts added to your organization’s contact book.", {
      exact: true,
    }),
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
  await page.getByText("Filter contacts", { exact: true }).click();
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
  await page
    .getByRole("button", { name: "Fields and tags", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Imports", exact: true }).click();
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
  await page
    .getByRole("combobox", { name: "Tag", exact: true })
    .selectOption("tag-volunteer");
  await page
    .getByRole("button", { name: "Apply to selection", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Sync status", exact: true }).click();
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
  await page.getByText("View and saved audiences", { exact: true }).click();
  await page
    .locator(
      '[data-workspace-action="book-column-earlier"][data-value="state"]',
    )
    .click();
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
    "displayName",
    "state",
    "city",
    "phone",
    "consentStatus",
  ]);
  expect(saved.visibility).toBe("private");
});

test("saved layouts can be edited, pinned, and published as the organization default", async ({
  page,
}) => {
  const { calls, errors } = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page.getByText("View and saved audiences", { exact: true }).click();
  await page
    .locator('[data-contact-change="book-column-pin"][value="displayName"]')
    .check();
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
  await page
    .getByRole("button", { name: "Fields and tags", exact: true })
    .click();
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
  await page.getByText("View and saved audiences", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Tag group: Interests", exact: true })
    .check();
  await expect(
    page.getByRole("columnheader", { name: "Interests", exact: true }),
  ).toBeVisible();
  await page.getByText("Filter contacts", { exact: true }).click();
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
  await page.getByRole("button", { name: "Sync status", exact: true }).click();
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
