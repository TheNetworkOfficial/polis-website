const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const PREFIX = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

async function teamFixture(page) {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "team-admin", email: "admin@example.test" })).toString("base64url")}.test`;
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
        set(value) {
          config = {
            ...value,
            apiBaseUrl: baseUrl,
            auth: {
              ...value.auth,
              clientId: "test",
              region: "us-west-2",
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
  const campaign = {
    campaignId: "campaign-one",
    name: "Example volunteer team",
    status: "draft",
    revision: 1,
    assignedUserIds: ["casey"],
    templateText: "Example team. Reply STOP to opt out.",
  };
  await page.route("https://profiles.example.test/**", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const method = request.method();
    const reply = (value) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...value }),
      });
    if (!path.startsWith(PREFIX)) return reply({});
    calls.push({ path, method, query: url.searchParams.get("query") });
    if (path.endsWith("/workspace"))
      return reply({
        workspace: {
          provider: "prompt",
          scopeKey: "coalition:org-1",
          manualOnly: true,
          status: "configured",
          capabilities: {
            createCampaigns: true,
            manageBilling: true,
            readContactBook: true,
          },
        },
      });
    if (path.endsWith("/billing/summary"))
      return reply({
        billing: {
          canManageBilling: true,
          availableMicros: 1000000,
          reservedMicros: 0,
          settledMicros: 0,
          rateStatus: "verified",
          smsUpToTwoSegmentsMicros: 35000,
        },
      });
    if (path.endsWith("/campaigns/campaign-one")) return reply({ campaign });
    if (path.endsWith("/campaigns/campaign-one/team"))
      return reply({
        campaignId: campaign.campaignId,
        campaignRevision: campaign.revision,
        members: [
          {
            userId: "casey",
            displayName: "Casey Existing",
            avatarUrl: "https://profiles.example.test/casey.png",
          },
        ],
        total: 1,
        nextCursor: null,
      });
    if (path.endsWith("/members")) {
      const query = url.searchParams.get("query");
      return reply({
        members: query.toLowerCase().startsWith("al")
          ? [
              {
                userId: "alex",
                displayName: "Alex Example",
                avatarUrl: "https://profiles.example.test/alex.png",
              },
            ]
          : query.toLowerCase().startsWith("bl")
            ? [{ userId: "blair", displayName: "Blair Example" }]
            : [],
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"error":"not_found"}',
    });
  });
  return { calls, errors };
}

test("teammate autocomplete preserves selections, input focus and photo fallback on mobile", async ({
  page,
}, info) => {
  const fixture = await teamFixture(page);
  await page.goto(`${BASE}/organizations/org-1/texting/team/campaign-one`);
  await expect(
    page.getByRole("heading", { name: "A little teamwork" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Find a teammate" });
  await expect(
    page.getByRole("checkbox", { name: "Select Casey Existing" }),
  ).toBeChecked();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/team")),
  ).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toHaveCount(0);
  await search.pressSequentially("Alex", { delay: 30 });
  await expect(
    page.getByRole("checkbox", { name: "Select Alex Example" }),
  ).toBeVisible();
  await expect(search).toBeFocused();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/members")),
  ).toEqual([{ path: PREFIX + "/members", method: "GET", query: "Alex" }]);
  const alexRow = page.locator(".pt-volunteer-row").filter({
    has: page.getByRole("checkbox", { name: "Select Alex Example" }),
  });
  const photo = alexRow.locator("[data-workspace-volunteer-avatar]");
  await expect(photo).toBeHidden();
  await expect(alexRow.locator(".pt-volunteer-avatar > span")).toHaveText("AE");
  await page.getByRole("checkbox", { name: "Select Alex Example" }).check();
  await search.fill("Blair");
  await expect(
    page.getByRole("checkbox", { name: "Select Alex Example" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Select Blair Example" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Select Alex Example" }),
  ).toBeChecked();
  await search.fill("");
  await expect(
    page.getByRole("checkbox", { name: "Select Blair Example" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Type a name or @username" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Select Alex Example" }),
  ).toBeChecked();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/members")),
  ).toHaveLength(2);
  expect(fixture.calls.every((call) => call.method === "GET")).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".pt-volunteer-picker")
    .screenshot({ path: info.outputPath("volunteer-autocomplete-mobile.png") });
  expect(fixture.errors).toEqual([]);
});
