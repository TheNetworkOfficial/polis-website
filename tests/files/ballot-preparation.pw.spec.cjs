const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK } = require("./contact-book-fixture.cjs");
const BALLOT = `${BOOK}/ballot-chaser`;
const policy = { version: "bounded_v1", enabled: true };

async function openPreparation(page, { returns = false, enabled = true } = {}) {
  const fixture = await mockBook(page, {
    capabilities: {
      ballotChaser: true,
      import: true,
      export: true,
      personal: true,
    },
  });
  const election = {
    electionId: "bounded-election",
    name: "C4D supervised ballot test",
    county: "Reviewed county",
    state: "AZ",
    storageMode: "register",
    preparationPolicy: policy,
    activeSnapshotId: returns ? "snapshot-one" : null,
    sourcePolicy: { permittedPurpose: "not_for_sms", reviewRequired: false },
  };
  const calls = [],
    uploaded = [];
  let job;
  const respond = (route, value) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...value }),
    });
  await page.route(`${BASE}${BALLOT}**`, async (route) => {
    const request = route.request(),
      suffix = new URL(request.url()).pathname.slice(BALLOT.length),
      body = request.postDataJSON();
    calls.push({ suffix, method: request.method(), body });
    if (suffix === "/elections")
      return respond(route, {
        items: [election],
        preparationAvailability: {
          enabled,
          policy: "bounded_v1",
          maxSourceBytes: 50000000,
          maxRows: 50000,
          maxColumns: 55,
        },
      });
    if (suffix === "/elections/bounded-election")
      return respond(route, { election });
    if (suffix.endsWith("/dashboard"))
      return respond(route, {
        dashboard: returns
          ? {
              snapshotId: "snapshot-one",
              total: 2,
              returned: 1,
              outstanding: 1,
              sourceAsOf: "2026-10-23T12:00:00Z",
            }
          : {},
      });
    if (suffix === "/imports" && request.method() === "GET")
      return respond(route, { items: [] });
    if (suffix.endsWith("/exports") || suffix === "/exports/retained-ids")
      return respond(route, {
        export: {
          exportId: "retained-ids",
          status: "ready",
          snapshotId: "snapshot-one",
          rows: 2,
        },
        download: {
          method: "GET",
          url: "https://fixture-private.s3.us-west-2.amazonaws.com/ids.csv",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      });
    if (suffix === "/imports" && request.method() === "POST") {
      job = {
        ...body,
        importId: "prepared-import",
        status: "uploading",
        counts: {},
        columns: returns ? ["Voter ID"] : ["ID", "CD", "Party", "Name"],
      };
      return respond(route, {
        import: job,
        upload: { method: "MULTIPART_REQUIRED" },
      });
    }
    if (suffix === "/imports/prepared-import/upload-start")
      return respond(route, {
        upload: {
          method: "MULTIPART",
          uploadId: "prepared-upload",
          partSizeBytes: 8 * 1024 * 1024,
          completedParts: [],
          parts: [
            {
              partNumber: 1,
              sizeBytes: job.sizeBytes,
              url: "https://fixture-private.s3.us-west-2.amazonaws.com/prepared-part",
              headers: {},
            },
          ],
        },
      });
    if (suffix === "/imports/prepared-import/upload-complete")
      return respond(route, { import: job });
    if (suffix === "/imports/prepared-import/inspect") {
      job.status = "awaiting_mapping";
      return respond(route, { import: job });
    }
    if (suffix === "/imports/prepared-import/mapping") {
      job = {
        ...job,
        status: "review_ready",
        profile: body.profile,
        counts: { rows: 2, conflicts: 0 },
      };
      return respond(route, { import: job });
    }
    return respond(route, { import: job });
  });
  await page.route(
    "https://fixture-private.s3.us-west-2.amazonaws.com/**",
    (route) => {
      if (route.request().method() === "PUT") {
        uploaded.push(route.request().postDataBuffer().toString("utf8"));
        return route.fulfill({
          headers: {
            etag: '"part-one"',
            "access-control-expose-headers": "etag",
            "access-control-allow-origin": BASE,
          },
          body: "",
        });
      }
      return route.fulfill({
        contentType: "text/csv",
        body: "ballotVoterId\r\n0001\r\n0002\r\n",
      });
    },
  );
  await page.goto(`${BASE}/workspace/coalition/org-1/work/ballot-chaser`);
  await expect(
    page.getByRole("heading", { name: "Ballot Chaser", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: returns ? "Upload next county report" : "Upload base file",
      exact: true,
    })
    .click();
  return { ...fixture, calls, uploaded };
}
async function inspect(page, name, text) {
  await page
    .locator('form[data-ballot-form="prepare-source"] input[type="file"]')
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await page
    .getByRole("button", { name: "Read columns and preview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review county columns" }),
  ).toBeVisible();
}
async function upload(page, reportDate = "2026-10-24") {
  await page.getByLabel("Official report date or timestamp").fill(reportDate);
  await page
    .getByLabel("I checked the selected count and this report's meaning.")
    .check();
  await page
    .getByRole("button", {
      name: "Upload prepared list and review columns",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review prepared county report" }),
  ).toBeVisible();
}

test("real browser worker previews and filters a county TXT before the first bounded multipart upload", async ({
  page,
}) => {
  const h = await openPreparation(page);
  await inspect(
    page,
    "county.txt",
    "ID|CD|Party|Name\r\n0001|8|ind|Alex Example\r\n0002|8|IND|Other Example\r\n0003|8|ind|Casey Example\r\n0004|9|ind|Another Example\r\n",
  );
  await page.getByLabel("Official voter ID column").selectOption("ID");
  await page.getByLabel("Congressional district column").selectOption("CD");
  await page.getByLabel("Exact district value").fill("8");
  await page.getByLabel("Party column", { exact: true }).selectOption("Party");
  await page.getByLabel("Exact party value").fill("ind");
  await page
    .getByLabel(
      "I confirmed this is the county header row and selected its official voter ID.",
    )
    .check();
  await page
    .getByRole("button", { name: "Prepare matching voters", exact: true })
    .click();
  await expect(
    page.getByText("4 source records · 2 selected · 2 excluded", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    h.calls.some(
      (call) => call.suffix === "/imports" && call.method === "POST",
    ),
  ).toBe(false);
  await upload(page);
  const create = h.calls.find(
    (call) => call.suffix === "/imports" && call.method === "POST",
  );
  expect(create.body.preparation).toEqual({ mode: "baseline" });
  expect(create.body.sourceAsOf).toBe("2026-10-24T00:00:00.000Z");
  expect(create.body.format).toBe("csv");
  expect(h.uploaded).toEqual([
    "ID,CD,Party,Name\r\n0001,8,ind,Alex Example\r\n0003,8,ind,Casey Example\r\n",
  ]);
  expect(h.calls.some((call) => call.suffix.endsWith("/upload-start"))).toBe(
    true,
  );
  await page
    .getByRole("button", { name: "Review this report", exact: true })
    .click();
  await expect
    .poll(
      () =>
        h.calls.find((call) => call.suffix.endsWith("/mapping"))?.body.profile,
    )
    .toMatchObject({ voterIdColumn: "ID", rowStatusMeans: "issued" });
  expect(h.errors).toEqual([]);
});

test("returns include already-returned voters, deduplicate exact IDs and upload only the matched canonical ID column", async ({
  page,
}) => {
  const h = await openPreparation(page, { returns: true });
  await inspect(
    page,
    "returns.txt",
    "Return ID,Name\r\n0002,Already returned\r\n0002,Repeated county row\r\n9999,Outside cohort\r\n0001,New return\r\n",
  );
  await page.getByLabel("Official voter ID column").selectOption("Return ID");
  await page
    .getByLabel(
      "I confirmed this is the county header row and selected its official voter ID.",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Match returns to this election",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review prepared returns" }),
  ).toBeVisible();
  expect(
    h.calls.find((call) => call.suffix.endsWith("/exports"))?.body,
  ).toMatchObject({
    snapshotId: "snapshot-one",
    view: "all",
    columns: ["ballotVoterId"],
  });
  await expect(
    page.getByText(/2 unique IDs matched this election; 1 rows outside/),
  ).toBeVisible();
  await upload(page, "2026-10-24T12:00:00-07:00");
  expect(h.uploaded).toEqual(["Voter ID\r\n0002\r\n0001\r\n"]);
  expect(
    h.calls.find((call) => call.suffix === "/imports" && call.method === "POST")
      ?.body.preparation,
  ).toEqual({ mode: "returns", snapshotId: "snapshot-one" });
  expect(
    h.calls.find((call) => call.suffix === "/imports" && call.method === "POST")
      ?.body.sourceAsOf,
  ).toBe("2026-10-24T19:00:00.000Z");
  await page
    .getByRole("button", { name: "Review this report", exact: true })
    .click();
  await expect
    .poll(
      () =>
        h.calls.find((call) => call.suffix.endsWith("/mapping"))?.body.profile,
    )
    .toMatchObject({ voterIdColumn: "Voter ID", rowStatusMeans: "returned" });
  expect(h.errors).toEqual([]);
});

test("server-disabled bounded preparation has no raw-file or upload controls", async ({
  page,
}) => {
  const h = await openPreparation(page, { enabled: false });
  await expect(
    page.getByText("Preparation unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('form[data-ballot-form="prepare-source"]'),
  ).toHaveCount(0);
  await expect(page.locator('form[data-ballot-form="upload"]')).toHaveCount(0);
  expect(h.calls.some((call) => call.method === "POST")).toBe(false);
});
