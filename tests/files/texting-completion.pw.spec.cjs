const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL;
const PREFIX = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";
const ACTOR = "completion-volunteer";
const counts = {
  accepted: 37,
  delivered: 31,
  failed: 2,
  pending: 4,
  needsReview: 0,
  inbound: 9,
};
async function fixture(
  page,
  {
    admin = false,
    state = "campaign_complete",
    personal = true,
    section = "send",
  } = {},
) {
  const calls = [],
    errors = [],
    control = {
      state,
      holdRefresh: null,
      failRefresh: false,
      completionReads: 0,
      archived: false,
    };
  const token = `e30.${Buffer.from(JSON.stringify({ sub: ACTOR })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ token, base }) => {
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
            apiBaseUrl: base,
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
    { token, base: BASE },
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(BASE) ? route.continue() : route.abort(),
  );
  const campaign = () => ({
    campaignId: "campaign-one",
    name: "Neighborhood check-in",
    revision: 7,
    status: control.archived ? "archived" : "active",
    canFetchQueue: !control.archived,
    assignedUserIds: [],
    templateText: "Hello neighbor. Reply STOP to opt out.",
  });
  await page.route(`${BASE}/api/**`, async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ ok: status === 200, ...body }),
      });
    if (!path.startsWith(PREFIX)) return respond({ items: [] });
    const suffix = path.slice(PREFIX.length),
      body = req.postDataJSON();
    calls.push({ suffix, body, method: req.method() });
    if (suffix === "/workspace")
      return respond({
        workspace: {
          provider: "prompt",
          scopeKey: "coalition:org-1",
          status: "configured",
          manualOnly: true,
          canSend: true,
          capabilities: {
            manualQueue: true,
            readReporting: true,
            createCampaigns: admin,
            manageBilling: false,
            queueRelease: true,
          },
        },
      });
    if (suffix === "/billing/summary")
      return respond({
        billing: { canManageBilling: false, sendingBlocked: false },
      });
    if (suffix === "/campaigns/campaign-one")
      return respond({ campaign: campaign() });
    if (suffix === "/campaigns/campaign-one/completion") {
      control.completionReads++;
      if (control.holdRefresh)
        await new Promise((done) => {
          control.holdRefresh = done;
        });
      if (control.failRefresh)
        return respond({ error: "temporarily_unavailable" }, 503);
      const state = control.archived ? "archived" : control.state;
      return respond({
        completion: {
          version: 1,
          campaignId: "campaign-one",
          campaignRevision: 7,
          state,
          asOfMs: Date.now(),
          proofId: "campaign-proof",
          campaign: {
            verified: state === "campaign_complete" || state === "archived",
            audienceTotal: 50,
            worked: state === "campaign_complete" ? 50 : 37,
            remaining:
              state === "campaign_complete" || state === "archived" ? 0 : 13,
            unresolved: state === "review_required" ? 4 : 0,
          },
          personal: {
            actorUserId: ACTOR,
            allocationId: "allocation-one",
            batchComplete: state === "batch_complete",
            counts: personal ? counts : null,
            coverage: personal ? "complete" : "unavailable",
          },
          results: {
            campaign: {
              counts: { ...counts, accepted: 50, delivered: 44 },
              coverage: "complete",
              asOfMs: Date.now(),
            },
            team: admin ? { contributorCount: 3 } : null,
            series: admin
              ? [2, 6, 7, 9, 11, 15].map((campaignAccepted, hour) => ({
                  hourStartMs:
                    Date.parse("2026-10-15T16:00:00Z") + hour * 3600000,
                  campaignAccepted,
                }))
              : [],
          },
          canArchive: admin && state === "campaign_complete",
          blockedReasons: [],
        },
      });
    }
    if (suffix.endsWith("/reporting"))
      return respond({
        report: {
          version: 1,
          campaignId: "campaign-one",
          coverage: "complete",
          unreadReplies: 0,
          counts: { ...counts, sent: 4, outbound: 37 },
        },
      });
    if (suffix.endsWith("/history"))
      return respond({ items: [], nextCursor: null });
    if (suffix === "/campaigns/campaign-one/transition") {
      control.archived = true;
      return respond({ campaign: campaign() });
    }
    if (suffix === "/campaigns/campaign-one/queue")
      return respond({
        campaignId: "campaign-one",
        state: "held",
        allocationId: "allocation-one",
        items: [
          {
            itemId: "recipient-one",
            state: "awaiting_confirmation",
            expiresAtMs: Date.now() + 600000,
            humanConfirmation: { recordId: "receipt-one" },
            preview: {
              contactDisplayName: "Alex Example",
              contactPhone: "+12025550124",
              message: campaign().templateText,
            },
          },
        ],
      });
    if (suffix.endsWith("/recipient-one/confirm")) {
      control.state = "campaign_complete";
      return respond({
        result: { itemId: "recipient-one", state: "accepted" },
      });
    }
    if (suffix.startsWith("/campaigns?"))
      return respond({ items: [campaign()] });
    return respond({ items: [] });
  });
  await page.goto(
    `${BASE}/organizations/org-1/texting/${section}/campaign-one`,
  );
  return { calls, errors, control };
}

for (const theme of ["dark", "light"])
  test(`phone finish and real personal/campaign results stay usable in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const f = await fixture(page);
    await page.evaluate(
      (theme) =>
        document.documentElement.setAttribute(
          "data-polis-theme-resolved",
          theme,
        ),
      theme,
    );
    await expect(
      page.getByRole("heading", { name: "Look what you did." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Exit campaign", exact: true }),
    ).toBeEnabled();
    await page.locator(".pt-completion").evaluate(async (node) => {
      await Promise.all(
        node
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: info.outputPath(`finish-${theme}-phone.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "See your results", exact: true })
      .click();
    await expect(page.locator(".pt-completion-sent > strong")).toHaveText("37");
    await page.getByRole("button", { name: "Campaign", exact: true }).click();
    await expect(page.locator(".pt-completion-sent > strong")).toHaveText("50");
    await expect(
      page.getByRole("button", { name: "Close & archive" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`results-${theme}-phone.png`),
      fullPage: true,
    });
    expect(f.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(f.errors).toEqual([]);
  });

test("admin reviews exact current campaign then explicitly confirms archive", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page, {
    admin: true,
    personal: false,
    section: "results",
  });
  await expect(page.locator(".pt-completion-sent > strong")).toHaveText("50");
  await page.screenshot({
    path: info.outputPath("campaign-results-wide.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("campaign-results-phone.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Close & archive", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("Neighborhood check-in");
  await expect(modal.getByRole("button", { name: "Keep open" })).toBeFocused();
  expect(f.calls.filter((call) => call.body)).toEqual([]);
  await page.screenshot({
    path: info.outputPath("archive-confirm-wide.png"),
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Close & archive", exact: true })
    .click();
  await expect(
    page.getByText("Archived · Sending and replies closed", { exact: true }),
  ).toBeVisible();
  const writes = f.calls.filter((call) => call.body);
  expect(writes).toEqual([
    {
      suffix: "/campaigns/campaign-one/transition",
      body: {
        expectedRevision: 7,
        action: "archive",
        completionProofId: "campaign-proof",
      },
      method: "POST",
    },
  ]);
  expect(f.errors).toEqual([]);
});

test("review required holds archive and unknown personal counts remain unknown", async ({
  page,
}, info) => {
  const f = await fixture(page, {
    admin: true,
    personal: false,
    state: "review_required",
    section: "results",
  });
  await expect(
    page.getByRole("button", { name: "Close & archive", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Your impact", exact: true }).click();
  await expect(
    page.getByText("Results unavailable", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("personal-results-unknown.png"),
    fullPage: true,
  });
  expect(f.calls.filter((call) => call.body)).toEqual([]);
});

test("refresh preserves cards during reads/failures and Exit remains immediately usable", async ({
  page,
}) => {
  const f = await fixture(page, { admin: true, section: "results" });
  await expect(page.locator(".pt-completion-sent > strong")).toHaveText("50");
  f.control.holdRefresh = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".pt-completion-sent > strong")).toHaveText("50");
  await expect(
    page.getByRole("button", { name: "Exit campaign", exact: true }),
  ).toBeEnabled();
  f.control.failRefresh = true;
  await expect.poll(() => typeof f.control.holdRefresh).toBe("function");
  const resume = f.control.holdRefresh;
  f.control.holdRefresh = null;
  resume();
  await expect(page.getByText(/Previous results/)).toBeVisible();
  await expect(page.locator(".pt-completion-sent > strong")).toHaveText("50");
  await expect(
    page.getByRole("button", { name: "Close & archive", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Exit campaign", exact: true })
    .click();
  await expect(page).toHaveURL(/\/texting\/campaigns$/);
  expect(f.calls.filter((call) => call.body)).toEqual([]);
});

test("last accepted recipient leads to verified finish without another allocation or send", async ({
  page,
}) => {
  const f = await fixture(page, { state: "waiting" });
  await page
    .getByRole("button", { name: "Get next recipients", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Send to Alex Example", exact: true })
    .click();
  await expect(
    page.getByText("Campaign texting finished", { exact: true }),
  ).toBeVisible();
  expect(f.calls.filter((call) => call.suffix.endsWith("/queue"))).toHaveLength(
    1,
  );
  expect(
    f.calls.filter((call) => call.suffix.endsWith("/confirm")),
  ).toHaveLength(1);
});

test("reduced motion suppresses celebration animations while Exit stays enabled", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await expect(
    page.getByText("Campaign texting finished", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".pt-completion")
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Exit campaign", exact: true }),
  ).toBeEnabled();
});
