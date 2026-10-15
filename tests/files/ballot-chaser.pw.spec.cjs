const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");
const ELECTION = {
  electionId: "az-general",
  name: "Arizona general",
  electionDate: "2026-11-03",
  county: "Pinal",
  state: "AZ",
  revision: 1,
};

async function openContactMapping(page) {
  const panel = page.locator("[data-ballot-mapping-details]");
  if ((await panel.getAttribute("open")) === null)
    await panel.getByText("Map contact information", { exact: true }).click();
}

async function mockBallots(
  page,
  {
    capabilities = {},
    legacyMatches = false,
    activeTargetCount,
    baseline = true,
    pending = false,
    multipart = false,
    scopeType = "coalition",
    queryDelay = 0,
    mappingHeaders = ["Voter ID", "Ballot", "Name"],
    mappingProfile,
    mappedStatus = "review_ready",
  } = {},
) {
  const BOOK = `/api/contact-book/scopes/${encodeURIComponent(`${scopeType}:org-1`)}`;
  const BALLOT = `${BOOK}/ballot-chaser`;
  const fixture = await mockBook(page, {
    scopeType,
    capabilities: { ballotChaser: true, ...capabilities },
    queryResponse: async (body, book) => {
      if (queryDelay)
        await new Promise((resolve) => setTimeout(resolve, queryDelay));
      const view = body.ballotChase?.view || "outstanding";
      const statuses = {
        outstanding: ["requested", "issued", "issued"],
        newly_returned: ["returned", "accepted", "returned"],
        returned: ["returned", "accepted", "cure_required"],
        needs_followup: ["cure_required", "rejected", "unknown"],
        all: ["issued", "accepted", "cure_required"],
      }[view];
      const rows = book.rows.map((row, i) => ({
        ...row,
        ballotChase: {
          electionId: "az-general",
          snapshotId: "snapshot-one",
          status: statuses[i],
          sourceAsOf: "2026-10-14T16:00:00Z",
          returnedAt: [
            "returned",
            "accepted",
            "cure_required",
            "rejected",
          ].includes(statuses[i])
            ? "2026-10-14T15:00:00Z"
            : null,
        },
      }));
      return {
        items: body.cursor ? rows.slice(2) : rows.slice(0, 2),
        nextCursor: body.cursor ? null : "page-2",
        complete: !!body.cursor,
        total: 3,
        bookRevision: 7,
      };
    },
  });
  const calls = [],
    configurationCalls = [],
    visits = [];
  const exportState = { stale: false, bookChanged: false };
  const importControl = { holdNextRead: false, release: null };
  let job,
    election = {
      ...ELECTION,
      activeSnapshotId: baseline ? "snapshot-one" : null,
      pendingSnapshotId: pending ? "pending-snapshot" : null,
      sourcePolicy: { permittedPurpose: "unreviewed", reviewRequired: true },
    },
    resolved = false,
    configuration = {
      revision: 2,
      roundId: null,
      canManage: true,
      questions: null,
      organizationDefaults: {
        revision: 1,
        questions: [
          {
            id: "existing",
            prompt: "Existing question",
            type: "single",
            required: false,
            choices: ["Yes", "No"],
          },
        ],
      },
      inherited: { questions: true },
      effective: {
        questions: [
          {
            id: "existing",
            prompt: "Existing question",
            type: "single",
            required: false,
            choices: ["Yes", "No"],
          },
        ],
      },
      availableRounds: [
        { roundId: "az-round", label: "Arizona general GOTV round" },
      ],
    };
  const dashboard = {
    snapshotId: baseline ? "snapshot-one" : null,
    sourceAsOf: "2026-10-14T16:00:00Z",
    previousSourceAsOf: "2026-10-13T16:00:00Z",
    coverage: "complete",
    total: 500,
    outstanding: 300,
    returned: 200,
    accepted: 170,
    needsFollowup: 10,
    statusCounts: {
      requested: 100,
      issued: 200,
      returned: 20,
      accepted: 170,
      cure_required: 5,
      rejected: 5,
      unknown: 0,
      not_requested: 0,
      cancelled: 0,
    },
    newlyReturned: 25,
    newlyDiscoveredReturned: 3,
    outreachThenReturned: 15,
    textOutreachThenReturned: 10,
    doorOutreachThenReturned: 8,
    ...(!baseline
      ? {
          total: 0,
          outstanding: 0,
          returned: 0,
          newlyReturned: 0,
          newlyDiscoveredReturned: 0,
          outreachThenReturned: 0,
          textOutreachThenReturned: 0,
          doorOutreachThenReturned: 0,
          sourceAsOf: null,
          previousSourceAsOf: null,
        }
      : {}),
  };
  const respond = (route, data) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...data }),
    });
  await page.route("**/ballot-chaser/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      suffix = url.pathname.slice(BALLOT.length),
      body = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ suffix, method: request.method(), body });
    if (
      suffix === "/elections/az-general/exports" ||
      suffix === "/exports/export-one"
    ) {
      if (exportState.stale || exportState.bookChanged)
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: exportState.bookChanged
              ? "contact_book_changed"
              : "ballot_snapshot_changed",
          }),
        });
      return respond(route, {
        export: {
          exportId: "export-one",
          status: request.method() === "POST" ? "building" : "ready",
          rows: request.method() === "POST" ? 0 : 3,
          snapshotId: "snapshot-one",
          view: body?.view || "outstanding",
          sourceAsOf: dashboard.sourceAsOf,
          previousSourceAsOf: dashboard.previousSourceAsOf,
        },
        ...(request.method() === "GET"
          ? {
              download: {
                method: "GET",
                url: "https://fictional-private.s3.us-west-2.amazonaws.com/export.csv",
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            }
          : {}),
      });
    }
    if (suffix === "/elections")
      return respond(
        route,
        request.method() === "POST"
          ? { election: { ...ELECTION, ...body } }
          : { items: [election] },
      );
    if (suffix === "/elections/az-general") {
      if (request.method() === "PATCH")
        election = { ...election, ...body, revision: election.revision + 1 };
      return respond(route, { election });
    }
    if (suffix === "/elections/az-general/dashboard")
      return respond(route, { dashboard });
    if (suffix === "/imports" && request.method() === "GET")
      return respond(route, { items: job ? [job] : [] });
    if (suffix === "/imports" && request.method() === "POST") {
      job = { ...body, importId: "ballot-import-one", status: "uploading" };
      return respond(route, {
        import: job,
        upload: {
          url: "https://fictional-private.s3.us-west-2.amazonaws.com/report",
          method: "PUT",
          headers: {},
        },
      });
    }
    if (suffix === "/imports/ballot-import-one/upload-start" && multipart)
      return respond(route, {
        import: job,
        upload: {
          method: "MULTIPART",
          uploadId: "upload-one",
          partSizeBytes: 8388608,
          completedParts: [],
          parts: Array.from(
            { length: Math.ceil(job.sizeBytes / 8388608) },
            (_, index) => ({
              partNumber: index + 1,
              sizeBytes: Math.min(8388608, job.sizeBytes - index * 8388608),
              url: `https://fictional-private.s3.us-west-2.amazonaws.com/part-${index + 1}`,
              headers: {},
            }),
          ),
        },
      });
    if (suffix === "/imports/ballot-import-one/upload-complete" && multipart)
      return respond(route, { import: job });
    if (suffix === "/imports/ballot-import-one/inspect") {
      job = {
        ...job,
        status: "awaiting_mapping",
        sheetName: "County report",
        sheets: [{ name: "County report" }, { name: "Readme" }],
        columns: mappingHeaders,
        ...(mappingProfile ? { profile: structuredClone(mappingProfile) } : {}),
        sampleRows: [["00017", "R", "Fictional voter"]],
      };
      return respond(route, { import: job });
    }
    if (suffix === "/imports/ballot-import-one/mapping") {
      job = {
        ...job,
        profile: {
          ...body.profile,
          fieldMapping: {
            ...body.profile.fieldMapping,
            ...Object.fromEntries(
              job.columns
                .filter(
                  (header) =>
                    !body.profile.sourceOnlyColumns?.includes(header) &&
                    !Object.hasOwn(body.profile.fieldMapping, header) &&
                    ![
                      body.profile.voterIdColumn,
                      body.profile.statusColumn,
                      body.profile.returnedDateColumn,
                      body.profile.requestedColumn,
                      body.profile.issuedColumn,
                    ].includes(header),
                )
                .map((header) => [header, `custom-${header}`]),
            ),
          },
        },
        mappingRevision: (job.mappingRevision || 0) + 1,
        status: mappedStatus,
        counts: {
          rows: 1,
          newContacts: 0,
          updatedContacts: 1,
          unchanged: 0,
          duplicateRows: 0,
          conflicts: legacyMatches ? 1 : 0,
        },
      };
      return respond(route, { import: job });
    }
    if (suffix === "/imports/ballot-import-one/apply") {
      job.status = "complete";
      return respond(route, { import: job });
    }
    if (suffix === "/imports/ballot-import-one/resolve") {
      resolved = true;
      job.counts.conflicts = 0;
      return respond(route, { import: job });
    }
    if (suffix === "/imports/ballot-import-one/rows")
      return respond(route, {
        items: [
          {
            row: 1,
            status:
              legacyMatches && !resolved
                ? "review_required"
                : job.status === "complete"
                  ? "applied"
                  : "ready",
            voterId: "00017",
            ...(legacyMatches && !resolved
              ? {
                  error: "ballot_legacy_identity_review",
                  candidates: [
                    {
                      contactId: "legacy-person",
                      revision: 7,
                      label: "Alex Example",
                      detail: "17 Fictional Way · phone ending 0021",
                      canLink: true,
                    },
                    {
                      contactId: "another-person",
                      revision: 2,
                      label: "Other Example",
                      detail: "Already assigned official ID",
                      canLink: false,
                    },
                  ],
                }
              : {}),
          },
        ],
      });
    if (suffix === "/imports/ballot-import-one" && importControl.holdNextRead) {
      importControl.holdNextRead = false;
      const captured = structuredClone(job);
      await new Promise((resolve) => {
        importControl.release = () => {
          resolve();
        };
      });
      return respond(route, { import: captured });
    }
    if (suffix === "/imports/ballot-import-one")
      return respond(route, { import: job });
    return route.fulfill({
      status: 404,
      body: JSON.stringify({ ok: false, error: "unexpected_ballot_endpoint" }),
    });
  });
  await page.route(
    "https://fictional-private.s3.us-west-2.amazonaws.com/**",
    (route) => {
      calls.push({
        suffix: "protected-file",
        method: route.request().method(),
        headers: route.request().headers(),
      });
      return route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": BASE,
          "Access-Control-Expose-Headers": "ETag",
          ETag: `"${new URL(route.request().url()).pathname}"`,
          ...(route.request().method() === "GET"
            ? {
                "Content-Disposition":
                  'attachment; filename="ballot-contacts.csv"',
                "Content-Type": "text/csv",
              }
            : {}),
        },
        body:
          route.request().method() === "GET"
            ? "Name,Ballot status\nAlex,issued\n"
            : "",
      });
    },
  );
  await page.route("**/api/voter-map/canvassing/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postData() ? request.postDataJSON() : undefined;
    configurationCalls.push({
      path: url.pathname,
      query: [...url.searchParams.entries()],
      method: request.method(),
      body,
    });
    if (url.pathname.endsWith("/configuration")) {
      if (request.method() === "PATCH")
        configuration = {
          ...configuration,
          ...body,
          inherited: { questions: false },
          effective: { questions: body.questions },
          revision: 3,
        };
      else configuration.roundId = url.searchParams.get("roundId");
      return respond(route, { configuration });
    }
    if (url.pathname.endsWith("/operations"))
      return respond(route, {
        items: [
          {
            locationId: "location-one",
            buildingId: "building-one",
            lat: 32.9,
            lng: -111.5,
            addressLabel: "17 Fictional Way",
          },
        ],
      });
    if (url.pathname.endsWith("/context"))
      return respond(route, {
        address: {
          line1: "17 Fictional Way",
          line2: "Unit 2",
          city: "Fictional",
          state: "AZ",
          postalCode: "00123",
        },
        operations: {
          status: "ready",
          access: { canKnock: true },
          ...(activeTargetCount != null
            ? { ballotChase: { activeTargetCount } }
            : {}),
          flags: {},
          round: { roundId: "az-round", status: "resolved" },
          location: { locationId: "location-one" },
          unit: { unitId: "unit-two", label: "Unit 2" },
          units: [{ unitId: "unit-two", label: "Unit 2" }],
          people: [
            {
              personId: "person-one",
              contactId: "contact-1",
              voterRecordId: "contact:contact-1",
              displayName: "Alex Example",
            },
          ],
        },
      });
    if (url.pathname.includes("/visits/")) {
      visits.push(body);
      return respond(route, {
        visit: { ...body, revision: 1 },
        operations: { status: "pending" },
      });
    }
    return route.fulfill({ status: 404 });
  });
  return {
    ...fixture,
    ballotCalls: calls,
    configurationCalls,
    visits,
    exportState,
    importControl,
  };
}

for (const [view, label] of Object.entries({
  outstanding: "Outstanding",
  newly_returned: "Newly returned",
  returned: "Returned",
  needs_followup: "Needs follow-up",
  all: "All voters",
})) {
  test(`${label} list uses the pinned view and keeps non-outstanding work read/export only`, async ({
    page,
  }, info) => {
    const f = await mockBallots(page);
    await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
    await page.getByLabel("Ballot list", { exact: true }).selectOption(view);
    await page.getByRole("button", { name: "Open list", exact: true }).click();
    await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
    const query = f.calls.find((c) => c.path === `${BOOK}/query`).body;
    expect(query.ballotChase.view).toBe(view);
    expect(query.ballotChase.snapshotId).toBe("snapshot-one");
    await page
      .getByRole("button", { name: "Select this page", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Create campaign", exact: true }),
    ).toHaveCount(view === "outstanding" ? 1 : 0);
    expect(f.calls.filter((c) => c.path.endsWith("/selections"))).toHaveLength(
      0,
    );
    expect(f.ballotCalls.filter((c) => c.method !== "GET")).toHaveLength(0);
    if (view === "newly_returned" || view === "needs_followup") {
      await page.screenshot({
        path: info.outputPath(`ballot-${view}-wide.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: info.outputPath(`ballot-${view}-phone.png`),
        fullPage: true,
      });
    }
  });
}

test("selected ballot CSV uses a private server job and clears stale downloads", async ({
  page,
}, info) => {
  const f = await mockBallots(page);
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page
    .getByRole("button", { name: "Show ballots not returned", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Export selected contacts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Preparing your CSV", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("ballot-export-progress-wide.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("ballot-export-progress-phone.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("button", { name: "Download CSV", exact: true }),
  ).toBeVisible();
  const created = f.ballotCalls.find(
    (c) => c.suffix === "/elections/az-general/exports",
  );
  expect(created.body.selection.mode).toBe("explicit");
  expect(created.body.selection.includeIds).toHaveLength(3);
  expect(created.body.columns).toEqual(
    expect.arrayContaining([
      "displayName",
      "ballotVoterId",
      "ballotStatus",
      "ballotReturnedAt",
      "ballotSourceAsOf",
      "ballotComparisonFrom",
      "ballotComparisonTo",
    ]),
  );
  expect(
    f.calls.some(
      (c) => c.path.endsWith("/selections") || c.path.includes("/exports/"),
    ),
  ).toBe(false);
  await page.screenshot({
    path: info.outputPath("ballot-server-export-wide.png"),
    fullPage: true,
  });
  f.exportState.stale = true;
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  await expect(
    page.getByText(
      "A new county update is available. Refresh Ballot Chaser and choose your list again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download CSV", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("ballot-stale-export-phone.png"),
    fullPage: true,
  });
});

test("large ballot upload sends bounded signed parts and every receipt before inspection", async ({
  page,
}) => {
  const f = await mockBallots(page, { multipart: true });
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page
    .getByRole("button", { name: "Upload next county report", exact: true })
    .click();
  await page.getByLabel("County spreadsheet").setInputFiles({
    name: "large-daily.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(17 * 1048576, 65),
  });
  await page.getByLabel("Report date and time").fill("2026-10-15T10:00");
  await page
    .getByRole("button", { name: "Upload and review columns", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Review columns and ballot status",
      exact: true,
    }),
  ).toBeVisible();
  const completion = f.ballotCalls.find((c) =>
    c.suffix.endsWith("/upload-complete"),
  );
  expect(
    f.ballotCalls.find((c) => c.suffix.endsWith("/upload-start")).body
      .sourceSha256,
  ).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(completion.body.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  expect(completion.body.parts.every((p) => p.etag)).toBe(true);
  expect(
    f.ballotCalls.filter((c) => c.suffix === "protected-file"),
  ).toHaveLength(3);
  expect(
    f.ballotCalls
      .filter((c) => c.suffix === "protected-file")
      .every((c) => !c.headers.authorization && !c.headers.cookie),
  ).toBe(true);
  expect(
    f.ballotCalls.some((c) => c.suffix.endsWith("/rows") && c.method !== "GET"),
  ).toBe(false);
});

test("candidate Ballot Chaser opens every view and uses its own private export scope", async ({
  page,
}) => {
  const f = await mockBallots(page, {
    scopeType: "candidate",
    queryDelay: 100,
  });
  await page.goto(`${BASE}/workspace/candidate/org-1/work/ballot-chaser`);
  await expect(
    page.getByRole("heading", { name: "Ballot Chaser", exact: true }),
  ).toBeVisible();
  for (const view of [
    "outstanding",
    "newly_returned",
    "returned",
    "needs_followup",
    "all",
  ]) {
    await page.getByLabel("Ballot list", { exact: true }).selectOption(view);
    await page.getByRole("button", { name: "Open list", exact: true }).click();
    await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
    await expect
      .poll(
        () =>
          f.calls.filter((c) => c.path.endsWith("/query")).at(-1)?.body
            .ballotChase.view,
      )
      .toBe(view);
  }
  await page
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create campaign", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Export selected contacts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download CSV", exact: true }),
  ).toBeVisible();
  expect(
    f.ballotCalls.find((c) => c.suffix.endsWith("/exports")).body.view,
  ).toBe("all");
  expect(
    f.calls
      .filter((c) => c.path.includes("/contact-book/scopes/"))
      .every((c) => c.path.includes("candidate%3Aorg-1")),
  ).toBe(true);
});

test("candidate without Ballot Chaser capability makes no election or export request", async ({
  page,
}) => {
  const f = await mockBallots(page, {
    scopeType: "candidate",
    capabilities: { ballotChaser: false },
  });
  await page.goto(`${BASE}/workspace/candidate/org-1/work/ballot-chaser`);
  await expect(
    page.getByText(
      "Ballot Chaser is not available for this organization yet.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(f.ballotCalls).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Open list", exact: true }),
  ).toHaveCount(0);
});

test("ballot dashboard uses the shared book and freezes election context through normal filters and campaign handoff", async ({
  page,
}, testInfo) => {
  const { calls, ballotCalls, errors } = await mockBallots(page);
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await expect(
    page.getByRole("heading", { name: "Ballot Chaser", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "40% returned" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Returned after org outreach",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("About these results", { exact: true }).click();
  await expect(
    page.getByText(
      "A confirmed conversation or literature drop credits all selected voters at the exact household or unit; it does not confirm an individual conversation with each voter.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Newly found already returned:", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "When no exact return time is supplied, outreach is compared with the first report showing a return.",
    ),
  ).toBeVisible();
  await page.getByText("About these results", { exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("ballot-chaser-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("ballot-chaser-mobile.png"),
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Show ballots not returned", exact: true })
    .click();
  await expect(page.getByText("Alex Example", { exact: true })).toBeVisible();
  const query = calls.find((call) => call.path === `${BOOK}/query`).body;
  expect(query.ballotChase).toEqual({
    electionId: "az-general",
    snapshotId: "snapshot-one",
    view: "outstanding",
    sourceAsOf: "2026-10-14T16:00:00Z",
    previousSourceAsOf: "2026-10-13T16:00:00Z",
    outstandingOnly: true,
  });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("State", { exact: true }).selectOption("AZ");
  await page
    .getByRole("button", { name: "Show contacts", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((call) => call.path === `${BOOK}/query`).length)
    .toBeGreaterThan(1);
  expect(
    calls.filter((call) => call.path === `${BOOK}/query`).at(-1).body
      .ballotChase,
  ).toEqual(query.ballotChase);
  await page.getByRole("button", { name: /^Select all/ }).click();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await expect(
    page.getByText("Write your message", { exact: true }),
  ).toBeVisible();
  expect(
    calls.find((call) => call.path === `${BOOK}/selections`).body.query
      .ballotChase,
  ).toEqual(query.ballotChase);
  expect(ballotCalls.some((call) => call.method === "POST")).toBe(false);
  expect(
    calls.some((call) => call.path.startsWith(PROMPT) && call.method !== "GET"),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("election setup requires an explicit source-use choice and preserves unreviewed as the default", async ({
  page,
}) => {
  const { ballotCalls, errors } = await mockBallots(page);
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  for (const [index, purpose] of [
    "unreviewed",
    "manual_sms",
    "sms_with_opt_in",
    "not_for_sms",
  ].entries()) {
    await page
      .getByRole("button", { name: "Add election", exact: true })
      .click();
    const form = page.locator('[data-ballot-form="election"]');
    await expect(
      form.getByLabel("Permitted use of this voter file"),
    ).toHaveValue("unreviewed");
    await form.getByLabel("Election name").fill("Arizona fixture election");
    await form.getByLabel("Election date").fill("2026-11-03");
    await form
      .getByLabel("Permitted use of this voter file")
      .selectOption(purpose);
    await form
      .getByRole("button", { name: "Add election", exact: true })
      .click();
    await expect
      .poll(
        () =>
          ballotCalls.filter(
            (c) => c.suffix === "/elections" && c.method === "POST",
          ).length,
      )
      .toBe(index + 1);
    const policy = ballotCalls
      .filter((c) => c.suffix === "/elections" && c.method === "POST")
      .at(-1).body.sourcePolicy;
    expect(policy).toEqual({
      permittedPurpose: purpose,
      reviewRequired: purpose === "unreviewed",
      requiresOptIn: purpose === "sms_with_opt_in",
      smsProhibited: purpose === "not_for_sms",
    });
    await expect(form).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

for (const choice of ["0", "create_new"]) {
  test(`matching an existing person requires explicit ${choice === "0" ? "link" : "separate contact"} review`, async ({
    page,
  }) => {
    const { ballotCalls, errors } = await mockBallots(page, {
      legacyMatches: true,
    });
    await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
    await page
      .getByRole("button", { name: "Upload next county report" })
      .click();
    await page.getByLabel("County spreadsheet").setInputFiles({
      name: "daily.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Voter ID,Ballot,Name\n00017,R,Fictional voter"),
    });
    await page.getByLabel("Report date and time").fill("2026-10-14T10:00");
    await page
      .getByRole("button", { name: "Upload and review columns" })
      .click();
    await page
      .getByLabel("County voter ID", { exact: true })
      .selectOption("Voter ID");
    await page
      .getByLabel("Ballot status column", { exact: true })
      .selectOption("Ballot");
    await page
      .getByLabel(
        "Status meanings (one original value = ballot state per line)",
      )
      .fill("R = returned");
    await page.getByRole("button", { name: "Review full update" }).click();
    await expect(
      page.getByRole("button", { name: "Apply reviewed county update" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Review record outcomes" }).click();
    const candidates = page.getByLabel("Existing contact for record 1");
    await expect(candidates).toHaveValue("");
    await expect(candidates.locator('option[value="1"]')).toHaveJSProperty(
      "disabled",
      true,
    );
    await expect(candidates).toContainText(
      "Alex Example · 17 Fictional Way · phone ending 0021",
    );
    expect(ballotCalls.some((c) => c.suffix.endsWith("/resolve"))).toBe(false);
    await candidates.selectOption(choice);
    await page
      .getByRole("button", { name: "Resolve contact identity" })
      .click();
    await expect
      .poll(
        () => ballotCalls.filter((c) => c.suffix.endsWith("/resolve")).length,
      )
      .toBe(1);
    expect(
      ballotCalls.find((c) => c.suffix.endsWith("/resolve")).body,
    ).toMatchObject(
      choice === "0"
        ? {
            row: 1,
            action: "link",
            selectedContactId: "legacy-person",
            expectedRevision: 7,
          }
        : { row: 1, action: "create_new" },
    );
    await expect(
      page.getByRole("button", { name: "Apply reviewed county update" }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

test("source-use review can be revised before the baseline and reload preserves its saved choice", async ({
  page,
}, testInfo) => {
  const { ballotCalls, errors } = await mockBallots(page, { baseline: false });
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  const review = page.locator('[data-ballot-form="source-policy"]');
  await expect(
    review.getByLabel("Permitted use of this voter file"),
  ).toHaveValue("unreviewed");
  await review
    .getByLabel("Permitted use of this voter file")
    .selectOption("sms_with_opt_in");
  await review.getByRole("button", { name: "Save source-use review" }).click();
  await expect
    .poll(
      () =>
        ballotCalls.filter(
          (c) => c.suffix === "/elections/az-general" && c.method === "PATCH",
        ).length,
    )
    .toBe(1);
  expect(ballotCalls.find((c) => c.method === "PATCH").body).toMatchObject({
    expectedRevision: 1,
    sourcePolicy: {
      permittedPurpose: "sms_with_opt_in",
      reviewRequired: false,
      requiresOptIn: true,
      smsProhibited: false,
    },
  });
  await expect(
    review.getByLabel("Permitted use of this voter file"),
  ).toHaveValue("sms_with_opt_in");
  await page.reload();
  await expect(
    review.getByLabel("Permitted use of this voter file"),
  ).toHaveValue("sms_with_opt_in");
  for (const [name, width, height] of [
    ["desktop", 1280, 880],
    ["mobile", 390, 840],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`source-policy-${name}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

for (const [name, options] of [
  ["pending publication", { baseline: false, pending: true }],
  ["completed baseline", { baseline: true }],
]) {
  test(`source-use review locks after ${name}`, async ({ page }) => {
    const { ballotCalls, errors } = await mockBallots(page, options);
    await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
    await expect(
      page.getByText(/Source-use review is locked while a report publishes/),
    ).toBeVisible();
    await expect(
      page.locator('[data-ballot-form="source-policy"]'),
    ).toHaveCount(0);
    expect(ballotCalls.some((c) => c.method === "PATCH")).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("all-returned exact-unit door stops new outreach even if generic map permission remains active", async ({
  page,
}) => {
  const { visits, configurationCalls, errors } = await mockBallots(page, {
    activeTargetCount: 0,
  });
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page
    .getByRole("button", { name: "Record DoorKnocker outreach" })
    .click();
  await page.getByRole("button", { name: "Open address" }).click();
  await expect(
    page.getByText(
      "All selected voters at this door have returned their ballots. Choose another door.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save outreach visit" }),
  ).toHaveCount(0);
  expect(visits).toEqual([]);
  expect(
    configurationCalls.some((c) =>
      c.query.some(([k, v]) => k === "runtime" && v === "true"),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("Excel upload reviews worksheet, mapping and whole-report outcomes before explicit publication", async ({
  page,
}) => {
  const { ballotCalls, errors } = await mockBallots(page);
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page.getByRole("button", { name: "Upload next county report" }).click();
  await page.getByLabel("County spreadsheet").setInputFiles({
    name: "daily.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fictional workbook for mocked parser"),
  });
  await page.getByLabel("Report date and time").fill("2026-10-14T10:00");
  await page.getByRole("button", { name: "Upload and review columns" }).click();
  await expect(
    page.getByRole("heading", { name: "Review columns and ballot status" }),
  ).toBeVisible();
  await expect(page.getByLabel("Every row in this file means")).toHaveValue("");
  await page
    .getByLabel("County voter ID", { exact: true })
    .selectOption("Voter ID");
  await page
    .getByLabel("Ballot status column", { exact: true })
    .selectOption("Ballot");
  await page
    .getByLabel("Status meanings (one original value = ballot state per line)")
    .fill("R = returned");
  await openContactMapping(page);
  await page.getByLabel("Name", { exact: true }).selectOption("displayName");
  await expect(
    page.getByLabel("Clear imported values when this column is blank"),
  ).toHaveValues([]);
  await page
    .getByLabel("Clear imported values when this column is blank")
    .selectOption(["Name"]);
  await page.getByRole("button", { name: "Review full update" }).click();
  await expect(
    page.getByRole("button", { name: "Apply reviewed county update" }),
  ).toBeVisible();
  expect(
    ballotCalls.find((call) => call.suffix.endsWith("/mapping")).body.profile,
  ).toMatchObject({
    voterIdColumn: "Voter ID",
    statusColumn: "Ballot",
    blankPolicy: "preserve",
    clearBlankColumns: ["Name"],
    statusMap: { R: "returned" },
  });
  expect(
    ballotCalls.find((call) => call.suffix.endsWith("/mapping")).body.profile
      .rowStatusMeans,
  ).toBeUndefined();
  expect(ballotCalls.some((call) => call.suffix.endsWith("/apply"))).toBe(
    false,
  );
  const protectedFile = ballotCalls.find(
    (call) => call.suffix === "protected-file",
  );
  expect(protectedFile.method).toBe("PUT");
  expect(protectedFile.headers.authorization).toBeUndefined();
  await page.getByRole("button", { name: "Review record outcomes" }).click();
  await expect(page.getByText("Record 1", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Apply reviewed county update" })
    .click();
  await expect
    .poll(() => ballotCalls.some((call) => call.suffix.endsWith("/apply")))
    .toBe(true);
  expect(errors).toEqual([]);
});

test("report-only mapping preserves saved fields, explicit county choices and cancel without contact-field churn", async ({
  page,
}, info) => {
  const f = await mockBallots(page, {
    mappingHeaders: [
      "Voter ID",
      "Ballot",
      "Name",
      "DailyExportTimestamp",
      "Precinct",
    ],
    mappingProfile: {
      voterIdColumn: "Voter ID",
      statusColumn: "Ballot",
      statusMap: { R: "returned" },
      fieldMapping: { Name: "saved-hidden-field" },
      sourceOnlyColumns: ["DailyExportTimestamp"],
    },
  });
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page
    .getByRole("button", { name: "Upload next county report", exact: true })
    .click();
  await page.getByLabel("County spreadsheet").setInputFiles({
    name: "daily.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Voter ID,Ballot,Name,DailyExportTimestamp,Precinct\n00017,R,Example,2026-10-15,P1",
    ),
  });
  await page.getByLabel("Report date and time").fill("2026-10-15T10:00");
  await page
    .getByRole("button", { name: "Upload and review columns", exact: true })
    .click();
  const importCard = page.locator("section.pt-card").filter({
    has: page.getByRole("heading", { name: "daily.csv", exact: true }),
  });
  await expect(importCard.getByRole("status")).toContainText("Review columns");
  await expect(importCard.getByRole("status")).toContainText("2026");
  await expect(importCard.getByRole("status")).not.toContainText(
    "awaiting_mapping",
  );
  await expect(importCard.getByRole("status")).not.toContainText(
    "2026-10-15T16:00:00.000Z",
  );
  await importCard.screenshot({
    path: info.outputPath("ballot-import-status-card.png"),
  });
  await openContactMapping(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "saved-hidden-field",
  );
  await expect(
    page.getByLabel("DailyExportTimestamp", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Precinct", { exact: true })
    .selectOption("__ballot_add_county_field__");
  await page.getByLabel("County-confirmed voter ID width (optional)").fill("8");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "saved-hidden-field",
  );
  await page.screenshot({
    path: info.outputPath("ballot-report-only-mapping-wide.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review full update", exact: true })
    .click();
  const profile = f.ballotCalls
    .filter((call) => call.suffix.endsWith("/mapping"))
    .at(-1).body.profile;
  expect(profile.fieldMapping).toEqual({ Name: "saved-hidden-field" });
  expect(profile.sourceOnlyColumns).toEqual([
    "Voter ID",
    "Ballot",
    "DailyExportTimestamp",
  ]);
  expect(JSON.stringify(profile)).not.toContain("__ballot_add_county_field__");
  await page.getByRole("button", { name: "Edit mapping", exact: true }).click();
  await openContactMapping(page);
  await expect(page.getByLabel("Precinct", { exact: true })).toHaveValue(
    "custom-Precinct",
  );
  await page.getByLabel("Name", { exact: true }).selectOption("");
  await page
    .getByRole("button", { name: "Cancel mapping changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit mapping", exact: true }).click();
  await openContactMapping(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "saved-hidden-field",
  );
  await expect(
    page.getByLabel("DailyExportTimestamp", { exact: true }),
  ).toHaveValue("");
  expect(
    f.ballotCalls.filter((call) => call.suffix.endsWith("/mapping")),
  ).toHaveLength(1);
  expect(f.ballotCalls.some((call) => call.suffix.endsWith("/apply"))).toBe(
    false,
  );
});

test("a late import poll cannot replace a newly reviewed mapping", async ({
  page,
}) => {
  const f = await mockBallots(page, {
    mappedStatus: "reviewing",
    mappingProfile: {
      voterIdColumn: "Voter ID",
      statusColumn: "Ballot",
      statusMap: { R: "returned" },
      fieldMapping: { Name: "displayName" },
    },
  });
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page
    .getByRole("button", { name: "Upload next county report", exact: true })
    .click();
  await page.getByLabel("County spreadsheet").setInputFiles({
    name: "daily.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Voter ID,Ballot,Name\n00017,R,Example"),
  });
  await page.getByLabel("Report date and time").fill("2026-10-15T10:00");
  await page
    .getByRole("button", { name: "Upload and review columns", exact: true })
    .click();
  await page.clock.install();
  await page
    .getByRole("button", { name: "Review full update", exact: true })
    .click();
  f.importControl.holdNextRead = true;
  await page.clock.runFor(5100);
  await expect.poll(() => typeof f.importControl.release).toBe("function");
  await page.getByRole("button", { name: "Edit mapping", exact: true }).click();
  await openContactMapping(page);
  await page.getByLabel("Name", { exact: true }).selectOption("");
  await page
    .getByRole("button", { name: "Review full update", exact: true })
    .click();
  f.importControl.release();
  await page.getByRole("button", { name: "Edit mapping", exact: true }).click();
  await openContactMapping(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  expect(
    f.ballotCalls.filter((call) => call.suffix.endsWith("/mapping")),
  ).toHaveLength(2);
  await expect(
    page.getByRole("button", {
      name: "Apply reviewed county update",
      exact: true,
    }),
  ).toHaveCount(0);
});

for (const rowMeaning of ["requested", "returned"]) {
  test(`a separate ${rowMeaning} list explicitly maps its row meaning without a status column`, async ({
    page,
  }) => {
    const { ballotCalls, errors } = await mockBallots(page);
    await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
    await page
      .getByRole("button", { name: "Upload next county report" })
      .click();
    await page.getByLabel("County spreadsheet").setInputFiles({
      name: `${rowMeaning}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from("Voter ID,Ballot,Name\n00017,,Fictional voter"),
    });
    await page.getByLabel("Report date and time").fill("2026-10-14T10:00");
    await page
      .getByRole("button", { name: "Upload and review columns" })
      .click();
    await page
      .getByLabel("County voter ID", { exact: true })
      .selectOption("Voter ID");
    await expect(page.getByLabel("Every row in this file means")).toHaveValue(
      "",
    );
    await page
      .getByLabel("Every row in this file means")
      .selectOption(rowMeaning);
    await page.getByRole("button", { name: "Review full update" }).click();
    await expect
      .poll(() => ballotCalls.some((c) => c.suffix.endsWith("/mapping")))
      .toBe(true);
    const profile = ballotCalls.find((c) => c.suffix.endsWith("/mapping")).body
      .profile;
    expect(profile).toMatchObject({
      voterIdColumn: "Voter ID",
      rowStatusMeans: rowMeaning,
      statusMap: {},
      blankPolicy: "preserve",
    });
    expect(profile.statusColumn).toBeUndefined();
    expect(ballotCalls.some((c) => c.suffix.endsWith("/apply"))).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("round preset preserves existing questions and live web visits retain exact person, door and question revision", async ({
  page,
}) => {
  const { configurationCalls, visits, errors } = await mockBallots(page);
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await page.getByRole("button", { name: "Ballot chasing questions" }).click();
  await page.getByLabel("Canvassing round").selectOption("az-round");
  await page.getByRole("button", { name: "Open selected round" }).click();
  await page.getByRole("button", { name: "Add ballot chasing preset" }).click();
  await expect(page.getByLabel("Question", { exact: true })).toHaveCount(4);
  await page
    .getByLabel("Question", { exact: true })
    .last()
    .fill("Notes for the next volunteer");
  await page.getByRole("button", { name: "Save round questions" }).click();
  const saved = configurationCalls.find((call) => call.method === "PATCH").body;
  expect(saved.questions[0].id).toBe("existing");
  expect(saved.questions[1].id).toBe("ballot_status");
  expect(saved.questions[3].prompt).toBe("Notes for the next volunteer");
  expect(saved.ballotChase).toEqual({ electionId: "az-general" });
  await page
    .getByRole("button", { name: "Record DoorKnocker outreach" })
    .click();
  await page.getByRole("button", { name: "Open address" }).click();
  await expect(
    page.getByRole("heading", { name: /17 Fictional Way · Unit 2/ }),
  ).toBeVisible();
  await page.getByLabel("Who did you speak with?").selectOption("0");
  await page
    .getByLabel("What did they say about their ballot?")
    .selectOption("Have ballot, not returned");
  await page.getByRole("button", { name: "Save outreach visit" }).click();
  await expect.poll(() => visits.length).toBe(1);
  expect(visits[0]).toMatchObject({
    outcome: "contacted",
    unitId: "unit-two",
    locationId: "location-one",
    questionSet: {
      roundId: "az-round",
      revision: 3,
      organizationRevision: 1,
      presetId: "ballot_chasing",
    },
  });
  expect(visits[0].respondents[0]).toMatchObject({
    contactId: "contact-1",
    questionAnswers: { ballot_status: "Have ballot, not returned" },
  });
  expect(visits[0].ballotStatus).toBeUndefined();
  expect(errors).toEqual([]);
});

test("read-only ballot viewers see progress without import receipts or import controls", async ({
  page,
}) => {
  const { ballotCalls, errors } = await mockBallots(page, {
    capabilities: { import: false, manage: false },
  });
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await expect(
    page.getByRole("heading", { name: "40% returned" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload next county report" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Update history" }),
  ).toHaveCount(0);
  expect(ballotCalls.some((call) => call.suffix === "/imports")).toBe(false);
  expect(errors).toEqual([]);
});

test("revoked ballot access clears private dashboard data instead of retaining stale results", async ({
  page,
}) => {
  const { errors } = await mockBallots(page);
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await expect(
    page.getByRole("heading", { name: "40% returned" }),
  ).toBeVisible();
  await page.route("**/ballot-chaser/elections/az-general/dashboard", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "contact_book_permission_denied",
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "40% returned" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Still to return" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Needs attention", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
