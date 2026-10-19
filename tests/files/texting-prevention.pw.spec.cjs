const { test, expect } = require("@playwright/test");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");
const SETUP =
  "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod/api/texting/setup/coalition/org-1";
const json = (route, body) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization,Content-Type",
    },
    body: JSON.stringify({ ok: true, ...body }),
  });

test("team save remains visible beside Continue on a narrow page and never opens or sends", async ({
  page,
}, info) => {
  await mockBook(page);
  const campaign = {
    campaignId: "campaign-one",
    revision: 3,
    name: "Neighborhood team",
    status: "draft",
    assignedUserIds: ["member-one"],
    templateText: "Example Civic Team. Reply STOP.",
    blockedReasons: [],
  };
  const writes = [];
  await page.route(`**${PROMPT}/campaigns/campaign-one**`, (route) => {
    if (route.request().method() === "POST") writes.push(route.request().url());
    if (route.request().url().includes("/team?"))
      return json(route, {
        campaignId: campaign.campaignId,
        campaignRevision: campaign.revision,
        members: [
          {
            userId: "member-one",
            displayName: "Helena Example",
            username: "helena",
          },
        ],
        nextCursor: null,
      });
    return json(route, { campaign });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/organizations/org-1/texting/team/campaign-one`);
  await page.getByRole("button", { name: "Save team", exact: true }).click();
  await expect(page.getByTestId("texting-team-saved")).toContainText(
    "Team already saved · 1 volunteer assigned",
  );
  await expect(
    page.getByRole("button", {
      name: "Continue to campaign review",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("team-saved-mobile.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByTestId("texting-team-saved")).toContainText(
    "Saved team · 1 volunteer assigned",
  );
  await page
    .getByRole("button", { name: "Continue to campaign review", exact: true })
    .click();
  await expect(page).toHaveURL(/texting\/campaigns\/campaign-one$/);
  expect(writes).toEqual([]);
});

test("isolated setup reviews named choices and uses only its fixed explicit activation handoff", async ({
  page,
}, info) => {
  const fixture = await mockBook(page);
  const calls = [];
  let saved = null;
  const action = {
    method: "POST",
    path: `${PROMPT}/campaigns/new-campaign/transition`,
    body: { expectedRevision: 4, action: "activate" },
  };
  await page.route("**/texting-setup-config.json", (route) =>
    json(route, {
      schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
      enabled: true,
      apiBaseUrl: "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
    }),
  );
  await page.route(`${SETUP}**`, (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    calls.push({ path, method, body: request.postDataJSON() });
    if (method === "GET" && path.endsWith("org-1"))
      return json(route, {
        setupAvailability: {
          state: "enabled",
          supportedWorkflowTypes: ["contact_book_single"],
        },
        capabilities: {
          isolatedSetup: true,
          createSetup: true,
          manageBilling: true,
        },
        setups: [],
        availableAudiences: [
          {
            audienceId: "selection-one",
            name: "Reviewed neighbors",
            count: 50,
          },
        ],
        volunteers: [
          {
            userId: "member-one",
            displayName: "Helena Example",
            username: "helena",
          },
        ],
      });
    if (method === "POST" && path.endsWith("/drafts"))
      saved = {
        setupId: "setup-one",
        campaignId: "new-campaign",
        revision: 1,
        state: "draft",
        canPrepare: true,
        draft: request.postDataJSON(),
        progress: { selected: 50, submitted: 0, verified: 0 },
      };
    else if (path.endsWith("/prepare"))
      saved = { ...saved, revision: 2, state: "preparing", canPrepare: false };
    else if (path.endsWith("/publish"))
      saved = {
        ...saved,
        revision: 4,
        state: "published",
        canPublish: false,
        handoff: { state: "pending", expectedRevision: 4, action },
      };
    else if (path.endsWith("/handoff")) saved = { ...saved, revision: 5 };
    return json(route, { setup: saved });
  });
  const oldWrites = [];
  await page.route(`**${PROMPT}/campaigns/new-campaign/transition`, (route) => {
    oldWrites.push(route.request().postDataJSON());
    saved = {
      ...saved,
      revision: 6,
      state: "handed_off",
      handoff: { state: "complete", expectedRevision: 4, action: null },
    };
    return route.abort("failed");
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns`);
  await expect(
    page.getByRole("link", { name: "Saved setups", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await expect(page).toHaveURL(/texting\/setup\/new$/);
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Neighborhood conversations");
  await page
    .getByLabel("Reviewed recipient selection", { exact: true })
    .selectOption({ label: "Reviewed neighbors · 50 recipients" });
  await page
    .getByLabel("Message", { exact: true })
    .fill("Example Civic Team. Hello neighbors. Reply STOP.");
  await page
    .getByLabel("Campaign spending limit ($)", { exact: true })
    .fill("5.00");
  await page
    .getByLabel("Sending starts", { exact: true })
    .fill("2099-10-18T10:00");
  await page
    .getByLabel("Sending ends", { exact: true })
    .fill("2099-10-18T18:00");
  await page.getByLabel("Helena Example · @helena", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save setup draft", exact: true })
    .click();
  await expect(page).toHaveURL(/texting\/setup\/setup-one$/);
  await expect(
    page.getByRole("region", { name: "Saved campaign setup" }),
  ).toContainText("Neighborhood conversations");
  expect(oldWrites).toEqual([]);
  await page
    .getByRole("button", { name: "Prepare selected recipients", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved campaign setup" }),
  ).toContainText("Preparing selected recipients");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Saved campaign setup" }),
  ).toContainText("Preparing selected recipients");
  expect(
    calls.filter(
      (call) => call.method === "POST" && call.path.endsWith("/prepare"),
    ),
  ).toHaveLength(1);
  saved = {
    ...saved,
    revision: 3,
    state: "ready",
    canPublish: true,
    progress: { selected: 50, submitted: 50, verified: 50 },
  };
  await page
    .getByRole("button", { name: "Check setup status", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review and open campaign", exact: true }),
  ).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({
      path: info.outputPath(`setup-review-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Review and open campaign", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved campaign setup" }),
  ).toContainText("Check the saved result");
  expect(oldWrites).toHaveLength(1);
  await page
    .getByRole("button", { name: "Check setup status", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Start texting", exact: true }),
  ).toHaveAttribute("href", "/organizations/org-1/texting/send/new-campaign");
  expect(oldWrites).toEqual([{ expectedRevision: 4, action: "activate" }]);
  expect(
    calls
      .filter((call) => call.method === "POST")
      .map((call) => call.path.split("/").at(-1)),
  ).toEqual(["drafts", "prepare", "publish", "handoff"]);
  expect(fixture.errors).toEqual([]);
});

test("a reloaded lost creation resolves its opaque saved request without repeating a write", async ({
  page,
}) => {
  const fixture = await mockBook(page),
    calls = [];
  const saved = {
    setupId: "recovered-setup",
    campaignId: "new-campaign",
    revision: 1,
    state: "draft",
    canPrepare: true,
    draft: {
      name: "Recovered creation",
      templateText: "Example Civic Team. Reply STOP.",
    },
    progress: { selected: 50, submitted: 0, verified: 0 },
  };
  await page.route("**/texting-setup-config.json", (route) =>
    json(route, {
      schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
      enabled: true,
      apiBaseUrl: "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
    }),
  );
  await page.route(`${SETUP}**`, (route) => {
    const request = route.request();
    calls.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
    });
    if (request.url() === SETUP)
      return json(route, {
        setupAvailability: {
          state: "enabled",
          supportedWorkflowTypes: ["contact_book_single"],
        },
        capabilities: {
          isolatedSetup: true,
          createSetup: true,
          manageBilling: true,
        },
        setups: [saved],
        availableAudiences: [],
        volunteers: [],
      });
    return json(route, { setup: saved });
  });
  await page.goto(
    `${BASE}/organizations/org-1/texting/setup/new?setupRequest=lost-create`,
  );
  await expect(page).toHaveURL(/texting\/setup\/recovered-setup$/);
  await expect(
    page.getByRole("region", { name: "Saved campaign setup" }),
  ).toContainText("Recovered creation");
  expect(
    calls.some((call) => call.path.endsWith("/requests/lost-create")),
  ).toBe(true);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  expect(fixture.errors).toEqual([]);
});

test("an uncommitted lost create restores its original draft after reload404 and retries only the same ID and body", async ({
  page,
}) => {
  const fixture = await mockBook(page),
    creates = [],
    reads = [];
  let saved = null;
  await page.route("**/texting-setup-config.json", (route) =>
    json(route, {
      schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
      enabled: true,
      apiBaseUrl: "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
    }),
  );
  await page.route(`${SETUP}**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      creates.push(request.postDataJSON());
      if (creates.length === 1) return route.abort("failed");
      saved = {
        setupId: "retried-original",
        campaignId: "new-campaign",
        revision: 1,
        state: "draft",
        canPrepare: true,
        draft: creates[0],
        progress: { selected: 50, submitted: 0, verified: 0 },
      };
      return json(route, { setup: saved });
    }
    reads.push(path);
    if (path.includes("/requests/") && !saved)
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "texting_setup_request_not_found" }),
      });
    if (path.endsWith("org-1"))
      return json(route, {
        setupAvailability: {
          state: "enabled",
          supportedWorkflowTypes: ["contact_book_single"],
        },
        capabilities: {
          isolatedSetup: true,
          createSetup: true,
          manageBilling: true,
        },
        setups: [],
        availableAudiences: [
          {
            audienceId: "selection-one",
            name: "Reviewed neighbors",
            count: 50,
          },
        ],
        volunteers: [
          {
            userId: "member-one",
            displayName: "Helena Example",
            username: "helena",
          },
        ],
      });
    return json(route, { setup: saved });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/setup/new`);
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Exact original draft");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Example Civic Team. Hello again. Reply STOP.");
  await page
    .getByLabel("Campaign spending limit ($)", { exact: true })
    .fill("5.25");
  await page
    .getByLabel("Sending starts", { exact: true })
    .fill("2099-10-18T10:00");
  await page
    .getByLabel("Sending ends", { exact: true })
    .fill("2099-10-18T18:00");
  await page.getByLabel("Helena Example · @helena", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save setup draft", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("may have been saved");
  expect(creates).toHaveLength(1);
  const envelope = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem(
        "polis.texting.setup.draft.v2.contact-admin.org-1",
      ),
    ),
  );
  expect(envelope.body).toEqual(creates[0]);
  expect(envelope.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "original draft is restored",
  );
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Exact original draft",
  );
  await expect(
    page.getByLabel("Campaign spending limit ($)", { exact: true }),
  ).toHaveValue("5.25");
  await expect(page.getByLabel("Sending starts", { exact: true })).toHaveValue(
    "2099-10-18T10:00",
  );
  await expect(
    page.getByLabel("Helena Example · @helena", { exact: true }),
  ).toBeChecked();
  expect(creates).toHaveLength(1);
  expect(reads).toContain(
    `/prod/api/texting/setup/coalition/org-1/requests/${creates[0].requestId}`,
  );
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Substitute draft");
  await page
    .getByRole("button", { name: "Retry same saved draft", exact: true })
    .click();
  await expect(
    page.getByText(/original draft has been restored/),
  ).toBeVisible();
  expect(creates).toHaveLength(1);
  await page
    .getByRole("button", { name: "Retry same saved draft", exact: true })
    .click();
  await expect(page).toHaveURL(/texting\/setup\/retried-original$/);
  expect(creates).toEqual([creates[0], creates[0]]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem(
        "polis.texting.setup.draft.v2.contact-admin.org-1",
      ),
    ),
  ).toBeNull();
  expect(fixture.errors).toEqual([]);
});
