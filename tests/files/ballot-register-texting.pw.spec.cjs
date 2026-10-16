const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");
const artifacts =
  process.env.POLIS_BALLOT_TEST_ARTIFACTS ||
  "D:/CodexHome/artifacts/polis-ballot-texting-handoff-20261015/website/output/playwright";
const ref = (n) => `voter_00_${String(n).repeat(64)}`;
const chase = {
  electionId: "register-general",
  snapshotId: "snapshot-one",
  view: "outstanding",
};
async function fixture(
  page,
  {
    alternatePhone = false,
    denied = false,
    scopeType = "coalition",
    loseAck = false,
  } = {},
) {
  const f = await mockBook(page, {
    scopeType,
    capabilities: { ballotChaser: true },
  });
  const calls = [],
    control = { denied, stale: false };
  const book = `/api/contact-book/scopes/${encodeURIComponent(`${scopeType}:org-1`)}`;
  let created = null,
    first = true,
    lastReview;
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
      fieldId: alternatePhone ? "source_Mobile" : "phone",
      label: alternatePhone ? "County mobile" : "Phone",
      type: "phone",
      textingPhone: true,
    },
    {
      fieldId: "ballotStatus",
      label: "Ballot status",
      type: "text",
      sortable: true,
      filterable: true,
    },
  ];
  const respond = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ ok: status === 200, ...body }),
    });
  const election = {
    electionId: chase.electionId,
    storageMode: "register",
    name: "Fictional county election",
    state: "MT",
    county: "Fictional County",
    activeSnapshotId: chase.snapshotId,
    revision: 1,
    sourcePolicy: { permittedPurpose: "manual_sms" },
  };
  await page.route("**/ballot-chaser/**", async (route) => {
    const request = route.request(),
      suffix = new URL(request.url()).pathname.slice(
        `${book}/ballot-chaser`.length,
      ),
      body = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ suffix, body, method: request.method() });
    if (suffix === "/elections") return respond(route, { items: [election] });
    if (suffix === `/elections/${chase.electionId}`)
      return respond(route, { election });
    if (suffix.endsWith("/dashboard"))
      return respond(route, {
        dashboard: {
          snapshotId: chase.snapshotId,
          total: 500000,
          outstanding: 300000,
          returned: 200000,
          newlyReturned: 15000,
          sourceAsOf: "2026-10-15T16:00:00Z",
          previousSourceAsOf: "2026-10-14T16:00:00Z",
        },
      });
    if (suffix.startsWith("/imports?electionId") || suffix === "/imports")
      return respond(route, { items: [] });
    if (suffix.endsWith("/voters"))
      return respond(route, {
        storageMode: "register",
        schema,
        items: ["Alex Example", "Blair Example", "Casey Example"]
          .slice(0, body.limit === 1 ? 1 : 3)
          .map((displayName, i) => ({
            voterRef: ref(i + 1),
            voterId: `000${i + 1}`,
            contactId: null,
            fields: { displayName, precinct: "0007", phone: "+12025550123" },
            ballotState: {
              status: body.view === "outstanding" ? "issued" : "returned",
            },
          })),
        total: body.filter ? 120001 : 300000,
        nextCursor: null,
        complete: true,
        ballotChase: { ...chase, view: body.view },
      });
    if (suffix.includes("/texting-selections")) {
      if (control.stale)
        return respond(route, { error: "ballot_snapshot_changed" }, 409);
      if (loseAck && body && first) {
        first = false;
        return route.abort("connectionfailed");
      }
      if (body) lastReview = body;
      const explicit = lastReview?.selection.mode === "explicit";
      return respond(route, {
        selection: {
          selectionId: "register-selection",
          sourceType: "ballot_register",
          status: body ? "building" : "ready",
          count: explicit ? 1 : 120000,
          eligibleCount: explicit ? 0 : 95000,
          consentReviewableCount: explicit ? 1 : 0,
          recipientCount: explicit ? 1 : 95000,
          excludedCount: explicit ? 0 : 25000,
          heldCounts: explicit
            ? {}
            : { duplicate_phone: 12000, invalid_phone: 10000, opted_out: 3000 },
          ballotChase: chase,
          manifestSha256: body ? undefined : "a".repeat(64),
          samples: [
            {
              displayName: "Alex Example",
              maskedPhone: "••• 0123",
              eligibility: explicit
                ? {
                    status: "held",
                    reasons: ["sender_consent_verification_required"],
                  }
                : { status: "eligible" },
            },
          ],
        },
      });
    }
    return respond(route, { error: "unexpected_ballot_endpoint" }, 404);
  });
  await page.route(
    `**${BOOK}/selections/register-selection/campaign`,
    (route) => {
      calls.push({
        suffix: "/bind",
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });
      return respond(route, {
        audienceId: "book_register-selection",
        exportAuthorized: false,
      });
    },
  );
  await page.route("**/api/text-banking/**", async (route) => {
    const request = route.request(),
      suffix = new URL(request.url()).pathname.slice(PROMPT.length),
      body = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ suffix: `texting${suffix}`, method: request.method(), body });
    if (suffix === "/workspace")
      return respond(route, {
        workspace: {
          provider: "polis",
          manualOnly: true,
          canSend: true,
          scopeKey: "coalition:org-1",
          status: "configured",
          capabilities: {
            createCampaigns: !control.denied,
            manageBilling: true,
          },
        },
      });
    if (suffix === "/billing/summary")
      return respond(route, {
        billing: {
          canManageBilling: true,
          rateStatus: "verified",
          smsUpToTwoSegmentsMicros: 35000,
          availableMicros: 10000000,
        },
      });
    if (suffix === "/delivery-schedule")
      return respond(route, {
        schedule: {
          status: "verified",
          timeZone: "America/Denver",
          startTime: "08:00",
          endTime: "20:00",
        },
      });
    if (suffix === "/campaigns" && body) {
      created = {
        ...body,
        ballotChase: chase,
        status: "draft",
        revision: 1,
        assignedUserIds: [],
        blockedReasons: [],
      };
      return respond(route, { campaign: created });
    }
    if (suffix.startsWith("/campaigns/") && request.method() === "GET")
      return respond(route, { campaign: created });
    return respond(route, { error: "unexpected_texting_endpoint" }, 404);
  });
  await page.goto(`${BASE}/workspace/${scopeType}/org-1/work/ballot-chaser`);
  await page
    .getByRole("button", { name: "Show ballots not returned", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "County voter list" }),
  ).toBeVisible();
  return { ...f, calls, control };
}

test("filtered all-matching register opens existing composer, reviews eligibility and saves only a draft", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByText("Filters", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Field", exact: true })
    .selectOption("precinct");
  await page
    .locator('[data-register-form="filters"]')
    .getByRole("textbox")
    .fill("0007");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select all matching", exact: true })
    .click();
  await expect(
    page.getByLabel("Select Blair Example", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Select Blair Example", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Create texting campaign", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start a conversation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save campaign", exact: true }),
  ).toBeDisabled();
  expect(
    f.calls.filter((c) => c.suffix.endsWith("/texting-selections") && c.body),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Review recipients", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check progress", exact: true })
    .click();
  await expect(page.getByText("95,000", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Shared phone numbers", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Outstanding ballot check-in");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Example Civic Team: check your ballot. Reply STOP to opt out.");
  await page.getByLabel("Spending limit ($)", { exact: true }).fill("1000");
  await expect(
    page.getByRole("button", { name: "Save campaign", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("I reviewed these recipients", { exact: true }).check();
  await page.screenshot({
    path: path.join(artifacts, "register-campaign-review-wide.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await expect
    .poll(
      () =>
        f.calls.filter(
          (c) => c.suffix === "texting/campaigns" && c.method === "POST",
        ).length,
    )
    .toBe(1);
  const review = f.calls.find(
    (c) => c.suffix.endsWith("/texting-selections") && c.body,
  );
  expect(review.body.selection).toEqual({
    mode: "all_matching",
    includeVoterRefs: [],
    excludeVoterRefs: [ref(2)],
  });
  expect(review.body.filter).toEqual({
    op: "and",
    conditions: [{ field: "precinct", op: "eq", value: "0007" }],
  });
  expect(review.body.snapshotId).toBe(chase.snapshotId);
  expect(
    f.calls.filter(
      (c) =>
        /\/contacts|\/transition|\/queue|\/export/.test(c.suffix) &&
        c.method === "POST",
    ),
  ).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("phone explicit selection chooses an advertised county phone column and recovers a lost review ACK", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, { alternatePhone: true, loseAck: true });
  await page.getByLabel("Select Alex Example", { exact: true }).check();
  await page
    .getByRole("button", { name: "Create texting campaign", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Phone column", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Phone column", exact: true })
    .selectOption("source_Mobile");
  await page
    .getByRole("button", { name: "Review recipients", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check this request", exact: true }),
  ).toBeVisible();
  const first = f.calls.find(
    (c) => c.suffix.endsWith("/texting-selections") && c.body,
  );
  await page
    .getByRole("button", { name: "Check this request", exact: true })
    .click();
  const reviews = f.calls.filter(
    (c) => c.suffix.endsWith("/texting-selections") && c.body,
  );
  expect(reviews).toHaveLength(2);
  expect(reviews[1].body).toEqual(first.body);
  expect(first.body.selection.includeVoterRefs).toEqual([ref(1)]);
  expect(first.body.phoneFieldId).toBe("source_Mobile");
  await page
    .getByRole("button", { name: "Check progress", exact: true })
    .click();
  await expect(
    page.getByLabel("I reviewed these recipients", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("I reviewed these recipients", { exact: true }).check();
  const estimate = page.getByRole("region", { name: "Campaign estimate" });
  await expect(estimate.getByText("1", { exact: true })).toBeVisible();
  await expect(estimate).toContainText(
    "Includes recipients awaiting sender consent review",
  );
  await expect(estimate).not.toContainText("per eligible contact");
  await page
    .getByLabel("I reviewed these recipients", { exact: true })
    .uncheck();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(artifacts, "register-campaign-review-phone.png"),
    fullPage: true,
  });
  expect(
    f.calls.filter(
      (c) =>
        c.method === "POST" &&
        /\/contacts|\/campaigns|\/transition|\/queue/.test(c.suffix),
    ),
  ).toEqual([]);
});

for (const gate of ["candidate", "texting-role"])
  test(`register campaign entry stays hidden for ${gate}`, async ({ page }) => {
    const f = await fixture(page, {
      scopeType: gate === "candidate" ? "candidate" : "coalition",
      denied: gate === "texting-role",
    });
    await expect(
      page.getByRole("button", {
        name: "Create texting campaign",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      f.calls.filter(
        (c) => c.method === "POST" && c.suffix.includes("texting-selections"),
      ),
    ).toEqual([]);
  });

test("publication changes after review block campaign bind and discard reviewed eligibility", async ({
  page,
}) => {
  const f = await fixture(page);
  await page
    .getByRole("button", { name: "Select all matching", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create texting campaign", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review recipients", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check progress", exact: true })
    .click();
  await page.getByLabel("I reviewed these recipients", { exact: true }).check();
  f.control.stale = true;
  await page
    .getByRole("button", { name: "Check progress", exact: true })
    .click();
  await expect(
    page.getByText("Choose a fresh ballot list", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save campaign", exact: true }),
  ).toBeDisabled();
  expect(
    f.calls.filter(
      (c) =>
        c.suffix === "/bind" || (c.suffix === "texting/campaigns" && c.body),
    ),
  ).toEqual([]);
});

test("returned register list keeps campaign creation unavailable", async ({
  page,
}) => {
  const f = await fixture(page);
  await page
    .getByLabel("Ballot list", { exact: true })
    .selectOption("returned");
  await page.getByRole("button", { name: "Open list", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Returned", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select all matching", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create texting campaign", exact: true }),
  ).toHaveCount(0);
  expect(
    f.calls.filter((call) => call.suffix.includes("texting-selections")),
  ).toEqual([]);
});
