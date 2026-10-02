const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const BOOK = "/api/contact-book/scopes/coalition%3Aorg-1";
const PROMPT = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

async function mockBook(
  page,
  {
    resume = false,
    duplicate = false,
    issues = false,
    recovery = false,
    publication,
    capabilities = {},
    configureFixture,
    queryResponse,
    personalization = null,
  } = {},
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
  const fixture = { fields, rows, tags, views, viewDefaults };
  configureFixture?.(fixture);
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
    if (path === "/api/geo/cities")
      return respond({
        state: url.searchParams.get("state"),
        cities:
          url.searchParams.get("state") === "MT"
            ? ["Billings", "Bozeman", "Helena"]
            : ["Phoenix", "Tucson"],
        version: "fixture",
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
            tag: true,
            campaign: true,
            ...capabilities,
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
      if (suffix.startsWith("/views/") && request.method() === "GET")
        return respond({
          view: views.find((view) => view.viewId === suffix.slice(7)),
        });
      if (suffix === "/tags" && request.method() === "POST") {
        const tag = {
          tagId: `tag-${tags.length + 1}`,
          label: body.label,
          revision: 1,
        };
        tags.push(tag);
        return respond({ tag });
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
        return respond(
          queryResponse
            ? await queryResponse(body, fixture)
            : {
                items: body?.cursor ? rows.slice(2) : rows.slice(0, 2),
                nextCursor: body?.cursor ? null : "page-2",
                complete: !!body?.cursor,
                total: 3,
                bookRevision: 7,
                ...(publication ? { publication } : {}),
              },
        );
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
            personalization,
            capabilities: {
              manageBilling: true,
              createCampaigns: true,
              uploadImports: true,
              readContactBook: capabilities.read !== false,
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
  return { calls, errors, ...fixture };
}

module.exports = { mockBook, BASE, BOOK, PROMPT };
