const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK } = require("./contact-book-fixture.cjs");

const plans = [
  ["starter", "Starter", 4900, 50],
  ["team", "Team", 19900, 250],
  ["campaign", "Campaign", 49900, 1000],
  ["network", "Network", 119900, 2500],
].map(([id, name, amountCents, dailyCredits]) => ({
  id,
  name,
  amountCents,
  dailyCredits,
  currency: "usd",
  interval: "month",
}));
const packs = [
  [1000, 900],
  [5000, 2900],
  [20000, 9900],
  [100000, 39900],
  [500000, 149900],
].map(([credits, amountCents]) => ({
  id: `pack_${credits}`,
  credits,
  amountCents,
  currency: "usd",
}));

test("billing review and organization closure prevent new commitments while preserving recovery controls", async ({
  page,
}) => {
  const f = await fixture(page, { paid: true });
  f.state.subscription.financialReview = {
    status: "required",
    reason: "payment_reversed",
  };
  f.state.subscription.closureHold = true;
  // A stale client flag cannot offer a payment while the explicit holds exist.
  f.state.subscription.checkoutEnabled = true;
  f.state.subscription.pendingChange = {
    checkoutUrl: "https://checkout.stripe.com/c/pay/local-held",
  };
  await f.open();
  const subscription = page.getByRole("region", {
    name: "Geocoding subscription",
  });
  await expect(subscription.getByText(/Billing needs review/)).toBeVisible();
  await expect(
    subscription.getByText(
      /Reopening the organization does not automatically restart/,
    ),
  ).toBeVisible();
  await expect(
    subscription.getByRole("button", {
      name: "Complete pending payment",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    subscription.getByRole("button", {
      name: "Verify subscription status",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    subscription.getByRole("button", {
      name: "Update payment method",
      exact: true,
    }),
  ).toBeEnabled();
  expect(f.payments).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("reopened organization keeps included credits paused and offers only explicit billing resumption", async ({
  page,
}) => {
  const f = await fixture(page, { paid: true });
  f.state.subscription.subscriptionRestartRequired = true;
  f.state.subscription.cancelAtPeriodEnd = true;
  await f.open();
  const subscription = page.getByRole("region", {
    name: "Geocoding subscription",
  });
  await expect(
    subscription.getByText(/Included credits remain paused after reopening/),
  ).toBeVisible();
  await expect(
    subscription.getByRole("button", {
      name: "Keep current plan renewing",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    f.calls.filter((call) =>
      ["/subscription/resume", "/subscription/checkout"].includes(call.path),
    ),
  ).toEqual([]);
  expect(f.payments).toEqual([]);
  expect(f.errors).toEqual([]);
});

async function fixture(
  page,
  {
    accepted = true,
    enabled = true,
    manage = true,
    purchase = true,
    paid = false,
  } = {},
) {
  const { errors } = await mockBook(page);
  const calls = [],
    payments = [];
  const state = {
    accepted,
    enabled,
    activated: true,
    failCheckout: false,
    expiredPreview: false,
    settings: {
      revision: 1,
      automatic: { enabled: false, usePurchased: false, purchasedDailyCap: 0 },
      field: { enabled: false, usePurchased: false, purchasedDailyCap: 0 },
    },
    program: { status: "idle", reviewCount: 0 },
    subscription: {
      status: "active",
      source: paid ? "stripe" : "pilot",
      revision: 1,
      planId: "campaign",
      dailyCredits: 1000,
      pilotEndsAt: Date.now() + 90 * 86400000,
      paidThrough: paid ? Date.now() + 30 * 86400000 : null,
      plans,
      checkoutEnabled: true,
      termsVersion: "payments-v1",
      termsUrl: `${BASE}/terms`,
      pendingChange: null,
    },
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) return route.fallback();
    if (
      [
        "checkout.stripe.com",
        "billing.stripe.com",
        "invoice.stripe.com",
      ].includes(url.hostname)
    ) {
      payments.push(url.href);
      return route.fulfill({
        contentType: "text/html",
        body: "<h1>Local payment fixture</h1>",
      });
    }
    return route.abort();
  });
  await page.route(
    "**/api/contact-book/scopes/**/geocoding/credits**",
    async (route) => {
      const path = new URL(route.request().url()).pathname.slice(
        `${BOOK}/geocoding/credits`.length,
      );
      const body = route.request().postDataJSON();
      calls.push({ path, body, method: route.request().method() });
      let value = {};
      if (!path)
        value = {
          enabled: state.enabled,
          activated: state.activated,
          spendingEnabled: true,
          available: state.subscription.dailyCredits,
          included: { available: state.subscription.dailyCredits },
          purchased: { available: 200 },
          resetAt: Date.now() + 86400000,
          settings: state.settings,
          legalEntityName: "Cascade Fixture Organization",
          legalEntityRevision: 3,
          permissions: {
            spend: true,
            manage,
            purchase,
            sign: manage,
            subscriptionManage: manage,
            dataRightsManage: true,
          },
          capabilities: { subscription: true, program: true },
          automationAvailable: true,
          rights: {
            accepted: state.accepted,
            available: true,
            manifest: {
              version: "geocode-v1",
              sha256: "a".repeat(64),
              url: `${BASE}/terms`,
            },
          },
          purchasesEnabled: true,
          creditPacks: packs,
          paymentTermsVersion: "packs-v1",
          paymentTermsUrl: `${BASE}/terms`,
        };
      else if (path === "/acceptance") {
        state.accepted = true;
        value = { acceptance: { version: body.version } };
      } else if (path === "/program") value = { program: state.program };
      else if (path === "/settings") {
        state.settings = { ...body, revision: body.expectedRevision + 1 };
        state.program = {
          status: body.automatic.enabled ? "waiting_for_credits" : "paused",
          reviewCount: 2,
          nextWakeAt: Date.now() + 86400000,
        };
        value = { settings: state.settings };
      } else if (path === "/subscription")
        value = { subscription: state.subscription };
      else if (path === "/subscription/preview")
        value = {
          preview: {
            previewId: "preview-1",
            planId: body.planId,
            expectedRevision: body.expectedRevision,
            kind: body.planId === "network" ? "upgrade" : "downgrade",
            amountDueCents: body.planId === "network" ? 23456 : 0,
            currency: "usd",
            expiresAt: Date.now() + (state.expiredPreview ? -1 : 600000),
            effectiveAt: state.subscription.paidThrough,
          },
        };
      else if (path === "/subscription/change") {
        if (state.rejectChange) {
          state.subscription.lastOperation = {
            operationId: body.operationId,
            status: "rejected",
            reason: "preview_changed",
          };
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "organization_subscription_preview_changed",
            }),
          });
        }
        const preview = [...calls]
          .reverse()
          .find((call) => call.path === "/subscription/preview").body;
        state.subscription.pendingChange = {
          kind: preview.planId === "network" ? "upgrade" : "downgrade",
          status:
            preview.planId === "network" ? "payment_pending" : "scheduled",
          planId: preview.planId,
          effectiveAt: state.subscription.paidThrough,
          operationId: body.operationId,
        };
        value = {
          status: state.subscription.pendingChange.status,
          subscription: state.subscription,
        };
      } else if (path === "/subscription/checkout") {
        if (state.failCheckout) {
          state.failCheckout = false;
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              message: "The response was lost. Verify the existing request.",
            }),
          });
        }
        state.subscription.pendingChange = {
          kind: "checkout",
          status: "pending",
          operationId: body.operationId,
        };
        value = {
          operationId: body.operationId,
          status: "pending",
          checkoutUrl: "https://checkout.stripe.com/c/pay/local-subscription",
        };
      } else if (path === "/subscription/reconcile") {
        if (state.settled) {
          state.subscription = {
            ...state.subscription,
            source: "stripe",
            planId: "network",
            dailyCredits: 2500,
            pendingChange: null,
            revision: 2,
          };
        }
        value = { subscription: state.subscription };
      } else if (path === "/subscription/cancel") {
        state.subscription.cancelAtPeriodEnd = true;
        state.subscription.revision++;
        value = { status: "scheduled", subscription: state.subscription };
      } else if (path === "/subscription/resume") {
        state.subscription.cancelAtPeriodEnd = false;
        state.subscription.pendingChange = null;
        state.subscription.revision++;
        value = { status: "active", subscription: state.subscription };
      } else if (path === "/subscription/portal")
        value = {
          checkoutUrl: "https://billing.stripe.com/p/session/local-methods",
        };
      else if (path === "/checkout")
        value = { checkoutUrl: "https://checkout.stripe.com/c/pay/local-pack" };
      else if (path === "/purchases")
        value = {
          items: state.packFunded
            ? [
                {
                  purchaseId: state.packOperation,
                  status: "funded",
                  credits: 1000,
                },
              ]
            : [],
        };
      else if (path === "/jobs") value = { items: [] };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...value }),
      });
    },
  );
  const open = async () => {
    await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
    const opener = page.getByRole("button", {
      name: "Geocode credits",
      exact: true,
    });
    if (enabled)
      await expect(
        opener.or(
          page.getByRole("heading", { name: "Geocode credits", exact: true }),
        ),
      ).toBeVisible();
    if (await opener.count()) await opener.click();
    if (enabled)
      await expect(
        page.getByRole("heading", { name: "Geocode credits", exact: true }),
      ).toBeVisible();
  };
  return { state, calls, payments, errors, open };
}

test("pilot approval shows exact catalogs and saves included-only autopilot with authoritative refreshed status", async ({
  page,
}, testInfo) => {
  const f = await fixture(page, { accepted: false });
  await f.open();
  await expect(page.getByText(/90-day pilot · ends/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Continue to secure checkout",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Continue to subscription checkout" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("combobox", { name: "Credit pack", exact: true })
      .locator("option"),
  ).toHaveCount(5);
  await expect(
    page
      .getByRole("combobox", { name: "Credit pack", exact: true })
      .locator("option"),
  ).toHaveText([
    "1,000 credits · $9.00 before tax",
    "5,000 credits · $29.00 before tax",
    "20,000 credits · $99.00 before tax",
    "100,000 credits · $399.00 before tax",
    "500,000 credits · $1,499.00 before tax",
  ]);
  for (const price of ["$49.00", "$199.00", "$499.00", "$1,199.00"])
    await expect(
      page.getByRole("cell", { name: price, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review custom field sharing" }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Signer name", exact: true })
    .fill("Fixture Signatory");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Director");
  await page.getByRole("checkbox", { name: /authorized to bind/ }).check();
  await page.getByRole("button", { name: "Accept for organization" }).click();
  await expect(page.getByText(/Geocoding agreement accepted/)).toBeVisible();
  expect(
    f.calls.find((call) => call.path === "/acceptance").body,
  ).toMatchObject({
    legalEntityRevision: 3,
    version: "geocode-v1",
    sha256: "a".repeat(64),
    source: "web",
    authorityToBind: true,
  });
  await expect(
    page.getByText("Also use purchased credits", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Enable automatic geocoding", exact: true })
    .check();
  await page.getByRole("button", { name: "Save geocoding settings" }).click();
  await expect(
    page.getByText(/Automatic geocoding: waiting for credits/),
  ).toBeVisible();
  expect(f.calls.find((call) => call.path === "/settings")).toMatchObject({
    method: "PATCH",
    body: {
      expectedRevision: 1,
      automatic: { enabled: true, usePurchased: false, purchasedDailyCap: 0 },
      field: { enabled: false, usePurchased: false, purchasedDailyCap: 0 },
    },
  });
  f.state.program.status = "caught_up";
  await page
    .getByRole("button", { name: "Refresh balance", exact: true })
    .click();
  await expect(page.getByText(/Automatic geocoding: caught up/)).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Enable automatic geocoding", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save geocoding settings" }).click();
  await expect(page.getByText(/Automatic geocoding: paused/)).toBeVisible();
  expect(
    f.calls.filter((call) => /executions|\/checkout/.test(call.path)),
  ).toHaveLength(0);
  expect(f.errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("pilot-approved-included-autopilot.png"),
    fullPage: true,
  });
});

test("pack-only purchaser cannot manage subscriptions and checkout preserves scoped recovery", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  const f = await fixture(page, { manage: false });
  await f.open();
  await expect(
    page.getByRole("button", { name: "Continue to subscription checkout" }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Credit pack", exact: true })
    .selectOption("pack_1000");
  await page
    .getByRole("checkbox", {
      name: "I accept these payment terms for the organization.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Continue to secure checkout", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Local payment fixture" }),
  ).toBeVisible();
  const checkout = f.calls.find((call) => call.path === "/checkout");
  expect(checkout.body).toMatchObject({
    packId: "pack_1000",
    acceptedPaymentTerms: "packs-v1",
  });
  await f.open();
  await expect(page.getByText("200 purchased", { exact: false })).toBeVisible();
  expect(f.calls.filter((call) => call.path === "/checkout")).toHaveLength(1);
  expect(f.calls.some((call) => call.path === "/purchases")).toBe(true);
  expect(f.payments).toEqual(["https://checkout.stripe.com/c/pay/local-pack"]);
  expect(f.errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("pack-purchaser-mobile-dark.png"),
    fullPage: true,
  });
});

test("subscription checkout retries an uncertain request with the same operation and resumes after return", async ({
  page,
}) => {
  const f = await fixture(page);
  f.state.failCheckout = true;
  await f.open();
  await page
    .getByRole("combobox", { name: "Monthly geocoding plan" })
    .selectOption("network");
  await page
    .getByRole("checkbox", {
      name: "I accept these subscription payment terms.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Continue to subscription checkout" })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry billing request" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry billing request" }).click();
  await expect(
    page.getByRole("heading", { name: "Local payment fixture" }),
  ).toBeVisible();
  const starts = f.calls.filter(
    (call) => call.path === "/subscription/checkout",
  );
  expect(starts).toHaveLength(2);
  expect(starts[1].body.operationId).toBe(starts[0].body.operationId);
  expect(starts[0].body).toMatchObject({
    planId: "network",
    acceptedTermsVersion: "payments-v1",
  });
  await f.open();
  await expect(
    page.getByText(/A billing request is awaiting confirmation/),
  ).toBeVisible();
  f.state.settled = true;
  await page
    .getByRole("button", { name: "Verify subscription status" })
    .click();
  await expect(page.getByText(/Network · active/)).toBeVisible();
  await expect(
    page.getByText(/A billing request is awaiting confirmation/),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("paid upgrade requires exact proration review and leaves old allowance until verified payment", async ({
  page,
}, testInfo) => {
  const f = await fixture(page, { paid: true });
  await f.open();
  await page
    .getByRole("combobox", { name: "Monthly geocoding plan" })
    .selectOption("network");
  await page
    .getByRole("checkbox", {
      name: "I accept these subscription payment terms.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Review plan change", exact: true })
    .click();
  await expect(page.getByText(/\$234.56 due now, prorated/)).toBeVisible();
  expect(
    f.calls.filter((call) => call.path === "/subscription/change"),
  ).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("upgrade-proration-review.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm paid upgrade" }).click();
  await expect(page.getByText(/upgrade payment pending/)).toBeVisible();
  await expect(page.getByText(/1,000 included credits per day/)).toBeVisible();
  expect(
    f.calls.find((call) => call.path === "/subscription/change").body,
  ).toMatchObject({
    previewId: "preview-1",
    expectedRevision: 1,
    acceptedTermsVersion: "payments-v1",
  });
  f.state.settled = true;
  await page
    .getByRole("button", { name: "Verify subscription status" })
    .click();
  await expect(page.getByText(/2,500 included credits per day/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("downgrade and cancellation wait for period end; resume and payment methods preserve authority", async ({
  page,
}) => {
  const f = await fixture(page, { paid: true });
  await f.open();
  await page
    .getByRole("combobox", { name: "Monthly geocoding plan" })
    .selectOption("team");
  await page
    .getByRole("checkbox", {
      name: "I accept these subscription payment terms.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Review plan change", exact: true })
    .click();
  await expect(
    page.getByText(/No charge now. The change takes effect/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm period-end change" }).click();
  await expect(page.getByText(/downgrade scheduled/)).toBeVisible();
  await page
    .getByRole("button", { name: "Keep current plan renewing" })
    .click();
  await page.getByRole("button", { name: "Confirm continued renewal" }).click();
  await page
    .getByRole("button", { name: "Cancel renewal", exact: true })
    .click();
  expect(
    f.calls.filter((call) => call.path === "/subscription/cancel"),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm cancellation at period end" })
    .click();
  await expect(
    page.getByText(/Your plan ends at the end of the paid period/),
  ).toBeVisible();
  await expect(page.getByText(/1,000 included credits per day/)).toBeVisible();
  await page.getByRole("button", { name: "Update payment method" }).click();
  await expect(
    page.getByRole("heading", { name: "Local payment fixture" }),
  ).toBeVisible();
  expect(f.payments).toEqual([
    "https://billing.stripe.com/p/session/local-methods",
  ]);
  expect(f.errors).toEqual([]);
});

test("expired upgrade preview cannot charge; disabled cohort does not open billing", async ({
  page,
}) => {
  const f = await fixture(page, { paid: true });
  f.state.expiredPreview = true;
  await f.open();
  await page
    .getByRole("combobox", { name: "Monthly geocoding plan" })
    .selectOption("network");
  await page
    .getByRole("checkbox", {
      name: "I accept these subscription payment terms.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Review plan change", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm paid upgrade" }),
  ).toBeDisabled();
  expect(
    f.calls.filter((call) => call.path === "/subscription/change"),
  ).toHaveLength(0);
  f.state.enabled = false;
  await page
    .getByRole("button", { name: "Refresh balance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Geocode credits", exact: true }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("server-rejected upgrade unlocks only after matching terminal receipt at the same revision", async ({
  page,
}) => {
  const f = await fixture(page, { paid: true });
  f.state.rejectChange = true;
  await f.open();
  await page
    .getByRole("combobox", { name: "Monthly geocoding plan" })
    .selectOption("network");
  await page
    .getByRole("checkbox", {
      name: "I accept these subscription payment terms.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Review plan change", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm paid upgrade" }).click();
  await expect(
    page.getByText(/A billing request is awaiting confirmation/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review plan change", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Verify subscription status" })
    .click();
  await expect(
    page.getByText(/Billing request rejected. Review the current plan/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review plan change", exact: true }),
  ).toBeEnabled();
  expect(f.state.subscription.revision).toBe(1);
  expect(
    f.calls.filter((call) => call.path === "/subscription/change"),
  ).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("awaiting activation permits agreement review but disables checkout and spending", async ({
  page,
}) => {
  const f = await fixture(page);
  f.state.activated = false;
  await f.open();
  await expect(
    page.getByText(/Awaiting organization activation by Polis/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to subscription checkout" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Continue to secure checkout",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review selected addresses" }),
  ).toBeDisabled();
  expect(
    f.calls.filter((call) => /checkout|executions/.test(call.path)),
  ).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
