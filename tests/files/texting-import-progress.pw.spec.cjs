const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9074";
const PREFIX = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

test("reviewed import stays on progress and recovers a lost status request", async ({
  page,
}, testInfo) => {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "import-admin", email: "admin@example.test" })).toString("base64url")}.test`;
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
  let status = "awaiting_mapping",
    releaseMapping,
    progressReads = 0;
  const writes = [];
  const job = () => ({
    importId: "import-one",
    revision: status === "awaiting_mapping" ? 1 : 2,
    status,
    file: { fileName: "example.csv" },
    mapping: {
      headers: ["phone"],
      fields: { phone: "phone" },
      source: {
        name: "Example",
        namespace: "example-2026",
        permittedPurpose: "manual_sms",
      },
    },
    progress: {
      rowsStaged: status === "staged" ? 1 : 0,
      rowsRejected: 0,
      partitionsPrepared: status === "staged" ? 1 : 0,
    },
    actions: {
      canReviewMapping: status === "awaiting_mapping",
      canRetry: status === "queued",
    },
  });
  await page.route(`${BASE}/api/**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const respond = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (!path.startsWith(PREFIX)) return respond({});
    const suffix = path.slice(PREFIX.length);
    if (request.method() !== "GET") writes.push(suffix);
    if (suffix === "/workspace")
      return respond({
        ok: true,
        workspace: {
          provider: "prompt",
          scopeKey: "coalition:org-1",
          manualOnly: true,
          status: "configured",
          canSend: true,
          capabilities: { uploadImports: true },
        },
      });
    if (suffix === "/billing/summary")
      return respond({
        ok: true,
        billing: {
          organizationName: "Example Civic Team",
          availableMicros: 1000000,
        },
      });
    if (suffix === "/imports/import-one/preview")
      return respond({
        ok: true,
        preview: {
          totalRows: 1,
          counts: { validPhones: 1, optedOut: 0 },
          rows: [
            {
              recordNumber: 2,
              phone: "+12025550124",
              consentStatus: "unknown",
              disposition: "preview_candidate",
            },
          ],
        },
      });
    if (suffix === "/imports/import-one/mapping") {
      await new Promise((resolve) => {
        releaseMapping = resolve;
      });
      status = "queued";
      return respond({ ok: true, import: job() });
    }
    if (suffix === "/imports/import-one") {
      if (status === "queued") {
        progressReads++;
        if (progressReads === 1) return route.abort("failed");
        status = "staged";
      }
      return respond({ ok: true, import: job() });
    }
    return route.fulfill({ status: 404, body: "Unexpected mock request" });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts/import-one`);
  await page
    .getByRole("button", { name: "Preview mapping", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the columns and this list’s permitted use.",
    })
    .check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Starting your import…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Match your columns" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("import-starting.png"),
    fullPage: true,
  });
  releaseMapping();
  await expect(
    page.getByRole("heading", { name: "Import progress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume processing" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Reconnecting to import status", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: testInfo.outputPath("import-reconnecting.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Contacts imported" }),
  ).toBeVisible({ timeout: 20000 });
  await page.screenshot({
    path: testInfo.outputPath("import-reviewed.png"),
    fullPage: true,
  });
  expect(writes).toEqual([
    "/imports/import-one/preview",
    "/imports/import-one/mapping",
  ]);
  expect(progressReads).toBe(2);
});
