const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const PAGE = `${BASE_URL}/organizations/org-1/texting-balance`;
const API = "/api/text-banking/prompt/scopes/coalition%3Aorg-1/billing/";
const BETA_TAX_NOTICE =
  "No tax is collected for this designated private beta purchase while Lux Corp reviews its tax treatment. This is not a tax exemption.";

function jwt(claims) {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.test`;
}

async function setup(page, options = {}) {
  const calls = [];
  const state = {
    status: "pending",
    funds: 0,
    admin: true,
    denied: false,
    checkoutFailures: 0,
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_example",
    acceptance: false,
    customAmount: {
      minimumCents: 1000,
      maximumCents: 200000,
      serviceFeeBasisPoints: 500,
    },
    termsVersion: "texting-payments-2026-09-23",
    ...options,
  };
  await page.addInitScript(
    ({ baseUrl, token }) => {
      const session = {
        accessToken: token,
        idToken: token,
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem("sharedFeedSession.v1", JSON.stringify(session));
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
    {
      baseUrl: BASE_URL,
      token: jwt({
        sub: options.userId || "billing-admin",
        email: "billing@example.test",
      }),
    },
  );
  const purchase = () => ({
    purchaseId: "purchase_1",
    packId: state.principalCents
      ? "custom"
      : state.acceptance
        ? "usd_acceptance_1"
        : "usd_100",
    status: state.status,
    principalCents: state.principalCents || (state.acceptance ? 100 : 10000),
    serviceFeeCents: state.principalCents
      ? Math.floor((state.principalCents + 10) / 20)
      : state.acceptance
        ? 5
        : 500,
    taxCents: state.status === "funded" ? (state.acceptance ? 0 : 210) : null,
    totalCents:
      state.status === "funded"
        ? state.principalCents
          ? state.principalCents +
            Math.floor((state.principalCents + 10) / 20) +
            210
          : state.acceptance
            ? 105
            : 10710
        : null,
    createdAtMs: 1789812000000,
    receiptUrl:
      state.status === "funded"
        ? "https://pay.stripe.com/receipts/example"
        : null,
  });
  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (
      !url.pathname.startsWith(API) &&
      !url.pathname.startsWith(API.replace("org-1", "org-2"))
    )
      return respond({});
    calls.push({
      path: url.pathname,
      search: url.search,
      method: request.method(),
      body: request.postDataJSON(),
    });
    if (state.denied) return respond({ error: "forbidden" }, 403);
    if (url.pathname.endsWith("summary"))
      return respond({
        ok: true,
        billing: {
          organizationName: "Example Civic Organization",
          currency: "usd",
          availableMicros: state.funds,
          reservedMicros: 45000,
          settledMicros: 35000,
          unfundedMicros: 0,
          rateStatus: "verified",
          smsUpToTwoSegmentsMicros: 35000,
          smsAdditionalSegmentMicros: 15000,
          mmsMicros: 45000,
          estimatedSmsMessages: Math.floor(state.funds / 35000),
          estimatedMmsMessages: Math.floor(state.funds / 45000),
          canManageBilling: state.admin,
          canPurchase:
            state.admin && !(state.acceptance && state.status === "funded"),
          sendingBlocked: state.funds === 0,
          billingHold: null,
          blockedReasons:
            state.acceptance && state.status === "funded"
              ? ["acceptance_purchase_completed"]
              : [],
          environment: state.acceptance ? "live" : "test",
          customAmount: state.acceptance ? null : state.customAmount,
          packs: state.acceptance
            ? state.status === "funded"
              ? []
              : [
                  {
                    id: "usd_acceptance_1",
                    principalCents: 100,
                    serviceFeeCents: 5,
                    totalBeforeTaxCents: 105,
                    notice:
                      "One-time acceptance purchase. Adds $1 to this organization’s texting balance.",
                  },
                ]
            : [100, 250, 500, 1000, 2000].map((amount) => ({
                id: `usd_${amount}`,
                principalCents: amount * 100,
                serviceFeeCents: amount * 5,
                totalBeforeTaxCents: amount * 105,
              })),
          terms: {
            version: state.termsVersion,
            url: "https://polisapp.io/texting-payment-terms",
            supportEmail: state.acceptance
              ? "lux@luxformontana.com"
              : "support@example.test",
            taxNotice: state.acceptance
              ? BETA_TAX_NOTICE
              : "Applicable tax is calculated in checkout.",
            refundPolicy: "No routine refunds.",
          },
        },
      });
    if (url.pathname.endsWith("checkouts")) {
      state.principalCents = request.postDataJSON()?.principalCents;
      if (state.checkoutDelayMs)
        await new Promise((resolve) =>
          setTimeout(resolve, state.checkoutDelayMs),
        );
      if (state.checkoutFailures-- > 0)
        return respond({ error: "temporary" }, 503);
      return respond({
        ok: true,
        purchase: { ...purchase(), checkoutUrl: state.checkoutUrl },
      });
    }
    if (url.pathname.includes("purchases/"))
      return respond({ ok: true, purchase: purchase() });
    if (url.pathname.endsWith("transactions"))
      return respond({
        ok: true,
        transactions: state.status === "funded" ? [purchase()] : [],
        nextCursor:
          state.status === "funded" && !url.searchParams.has("cursor")
            ? "next_page"
            : null,
      });
    return respond({ error: "unexpected" }, 404);
  });
  return { calls, state };
}

test("admin reviews each server-owned pack, retries the same purchase, and uses hosted checkout", async ({
  page,
}) => {
  const { calls } = await setup(page, { checkoutFailures: 1 });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ body: "Test checkout" }),
  );
  await page.goto(PAGE);
  await expect(
    page.getByRole("heading", { name: "Texting balance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add texting funds", exact: true })
    .click();
  for (const [funds, fee, total] of [
    [100, 5, 105],
    [250, 12.5, 262.5],
    [500, 25, 525],
    [1000, 50, 1050],
    [2000, 100, 2100],
  ]) {
    const usd = (value) =>
      value.toLocaleString("en-US", { style: "currency", currency: "USD" });
    await page
      .locator(".texting-balance__packs")
      .getByRole("button", { name: usd(funds), exact: true })
      .click();
    const review = page.locator(".texting-balance__review");
    await expect(review).toContainText("Example Civic Organization");
    await expect(review.locator("dd")).toHaveText([
      usd(funds),
      usd(fee),
      usd(total),
    ]);
    await expect(
      page.getByRole("button", { name: "Continue to secure checkout" }),
    ).toBeDisabled();
  }
  await page.getByRole("checkbox").check();
  await page.screenshot({
    path: test.info().outputPath("purchase-review.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Retry to recover the same purchase",
  );
  await page
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(page).toHaveURL(
    "https://checkout.stripe.com/c/pay/cs_test_example",
  );
  const creates = calls.filter((call) => call.method === "POST");
  expect(creates).toHaveLength(2);
  expect(creates[0].body).toEqual(creates[1].body);
  expect(Object.keys(creates[0].body).sort()).toEqual([
    "idempotencyKey",
    "packId",
  ]);
  expect(creates[0].body.packId).toBe("usd_2000");
});

test("return URL cannot credit funds; verified funding shows principal, receipt and paginated history", async ({
  page,
}) => {
  const { state, calls } = await setup(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(
    `${PAGE}?purchase=purchase_1&checkout=returned&amount=2000&status=funded`,
  );
  await expect(page.getByTestId("texting-purchase-status")).toContainText(
    "Payment processing",
  );
  await expect(page.getByTestId("texting-available")).toHaveText("$0.00");
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  state.status = "funded";
  state.funds = 100000000;
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByTestId("texting-purchase-status")).toContainText(
    "$100.00 was added",
  );
  await expect(page.getByTestId("texting-available")).toHaveText("$100.00");
  await expect(page.locator(".texting-balance")).toContainText(
    "$0.0150 per additional SMS segment",
  );
  await expect(
    page
      .getByTestId("texting-purchase-status")
      .getByRole("link", { name: "View receipt" }),
  ).toHaveAttribute("href", "https://pay.stripe.com/receipts/example");
  await expect(page.locator(".texting-balance__history")).toContainText(
    "Fee $5.00 · Tax $2.10 · Total $107.10",
  );
  await page.getByRole("button", { name: "View all", exact: true }).click();
  await page.getByRole("button", { name: "Load more purchases" }).click();
  await expect(page.locator(".texting-balance__transaction")).toHaveCount(2);
  expect(calls.some((call) => call.search.includes("cursor=next_page"))).toBe(
    true,
  );
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 2);
  await page.screenshot({
    path: test.info().outputPath("funded-mobile.png"),
    fullPage: true,
  });
});

test("designated acceptance purchase shows its real amount and beta terms, then closes after funding", async ({
  page,
}) => {
  const { state, calls } = await setup(page, { acceptance: true });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ body: "Test stand-in for live hosted checkout" }),
  );
  await page.goto(PAGE);
  await page
    .getByRole("button", { name: "Add texting funds", exact: true })
    .click();
  await expect(page.locator(".texting-balance__packs button")).toHaveText([
    "$1.00",
  ]);
  await page.getByRole("button", { name: "$1.00", exact: true }).click();
  const review = page.locator(".texting-balance__review");
  await expect(review.locator("dd")).toHaveText(["$1.00", "$0.05", "$1.05"]);
  await expect(review).toContainText(BETA_TAX_NOTICE);
  await expect(
    page.getByText("Test mode — no real payment is collected.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "lux@luxformontana.com", exact: true }),
  ).toHaveAttribute("href", "mailto:lux@luxformontana.com");
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(review.locator("dd")).toHaveText(["$1.00", "$0.05", "$1.05"]);
  await page.screenshot({
    path: test.info().outputPath("acceptance-purchase-review.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(page).toHaveURL(state.checkoutUrl);
  const creates = calls.filter((call) => call.method === "POST");
  expect(creates).toHaveLength(1);
  expect(creates[0].body.packId).toBe("usd_acceptance_1");
  expect(Object.keys(creates[0].body).sort()).toEqual([
    "idempotencyKey",
    "packId",
  ]);

  state.status = "funded";
  state.funds = 1000000;
  await page.goto(`${PAGE}?purchase=purchase_1&checkout=returned`);
  await expect(page.getByTestId("texting-purchase-status")).toContainText(
    "$1.00 was added",
  );
  await expect(page.getByTestId("texting-available")).toHaveText("$1.00");
  await expect(page.locator(".texting-balance__history")).toContainText(
    "Fee $0.05 · Tax $0.00 · Total $1.05",
  );
  await expect(page.locator(".texting-balance")).toContainText(
    "Purchases are unavailable",
  );
  await expect(page.locator(".texting-balance__packs")).toHaveCount(0);

  await page.goto(`${BASE_URL}/texting-payment-terms`);
  await expect(page.locator("main")).toContainText(
    "texting-payments-2026-09-23",
  );
  await expect(page.locator("main")).toContainText(
    "It is a real payment, not a sandbox transaction.",
  );
  await expect(page.locator("main")).toContainText(
    "This is not a tax exemption",
  );
  await expect(page.locator("main")).not.toContainText("support@polisapp.io");
});

test("members cannot access balance or request history, and revoked access clears financial details", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(BASE_URL).origin
      ? route.fallback()
      : route.abort(),
  );
  const { state, calls } = await setup(page, {
    admin: false,
    funds: 100000000,
  });
  await page.goto(`${PAGE}?purchase=purchase_1&checkout=returned`);
  await expect(page.getByRole("alert")).toContainText("do not have access");
  await expect(page.getByTestId("texting-available")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Balance", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Add texting funds" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Purchase history" }),
  ).toHaveCount(0);
  expect(
    calls.some((call) => /transactions|purchases|checkouts/.test(call.path)),
  ).toBe(false);
  state.denied = true;
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByRole("alert")).toContainText("do not have access");
  await expect(page.getByTestId("texting-available")).toHaveCount(0);
});

test("canceled and failed checkouts do not change balance; untrusted checkout destinations are rejected", async ({
  page,
}) => {
  const { state } = await setup(page, {
    funds: 100000000,
    checkoutUrl: "https://checkout.stripe.com.evil.test/pay",
  });
  await page.goto(`${PAGE}?purchase=purchase_1&checkout=canceled`);
  await expect(page.getByTestId("texting-purchase-status")).toContainText(
    "Payment processing",
  );
  await expect(page.getByTestId("texting-available")).toHaveText("$100.00");
  state.status = "failed";
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByTestId("texting-purchase-status")).toContainText(
    "Payment failed",
  );
  await expect(page.getByTestId("texting-available")).toHaveText("$100.00");
  state.status = "pending";
  await page
    .getByRole("button", { name: "Add texting funds", exact: true })
    .click();
  await page
    .locator(".texting-balance__packs")
    .getByRole("button", { name: "$100.00", exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Checkout could not be opened",
  );
  await expect(page).toHaveURL(`${PAGE}?purchase=purchase_1&checkout=canceled`);
});

test("custom amount keeps typing focused, validates cents, and renews authorization when the amount or policy changes", async ({
  page,
}) => {
  const { calls, state } = await setup(page);
  await page.goto(PAGE);
  await page
    .getByRole("button", { name: "Add texting funds", exact: true })
    .click();
  const other = page.getByRole("button", { name: "Other", exact: true });
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  const input = page.getByRole("textbox", { name: "Amount in dollars" });
  await expect(input).toBeFocused();
  await input.pressSequentially("12.50");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("12.50");
  expect(await input.evaluate((element) => element.selectionStart)).toBe(5);
  const totals = page.locator(".texting-balance__review dd");
  await expect(totals).toHaveText(["$12.50", "$0.63", "$13.13"]);
  for (const value of [
    "",
    "9.99",
    "10.001",
    "1e2",
    "-10",
    "Infinity",
    "99999999999999999999",
    "2000.01",
  ]) {
    await input.fill(value);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[data-texting-amount-error]")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue to secure checkout" }),
    ).toHaveCount(0);
  }
  for (const [value, amounts] of [
    ["10", ["$10.00", "$0.50", "$10.50"]],
    ["10.01", ["$10.01", "$0.50", "$10.51"]],
  ]) {
    await input.fill(value);
    await expect(totals).toHaveText(amounts);
    await expect(input).toHaveAttribute("aria-invalid", "false");
  }
  await page.getByRole("checkbox").check();
  await input.fill("12.50");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(input).toHaveValue("12.50");
  state.termsVersion = "updated-terms";
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  state.customAmount = { ...state.customAmount, maximumCents: 100000 };
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByText("$10.00 minimum · $1,000.00 maximum", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "$100.00", exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(totals).toHaveText(["$100.00", "$5.00", "$105.00"]);
  await page.getByRole("checkbox").check();
  await other.click();
  await expect(input).toHaveValue("12.50");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  state.customAmount = { ...state.customAmount, maximumCents: 200000 };
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(
    page.getByText("$10.00 minimum · $2,000.00 maximum", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("custom-amount-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({
    path: test.info().outputPath("custom-amount-mobile.png"),
    fullPage: true,
  });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 2);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: test.info().outputPath("custom-amount-mobile-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: test.info().outputPath("custom-amount-desktop-dark.png"),
    fullPage: true,
  });
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  state.customAmount = null;
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(other).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("custom checkout retries bind to normalized amount and organization, prevent double clicks, and clear only a completed amount", async ({
  page,
}) => {
  const { calls, state } = await setup(page, {
    checkoutFailures: 10,
    checkoutDelayMs: 200,
  });
  const posts = () => calls.filter((call) => call.method === "POST");
  async function openCustom(url = PAGE) {
    await page.goto(url);
    await page
      .getByRole("button", { name: "Add texting funds", exact: true })
      .click();
    await page.getByRole("button", { name: "Other", exact: true }).click();
  }
  async function attempt(value) {
    await page.getByRole("textbox", { name: "Amount in dollars" }).fill(value);
    await page.getByRole("checkbox").check();
    await expect(
      page.getByRole("button", { name: "Continue to secure checkout" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Continue to secure checkout" })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await expect(
      page.getByRole("textbox", { name: "Amount in dollars" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Other", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("checkbox")).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText(
      "Retry to recover the same purchase",
    );
  }
  await openCustom();
  await attempt("10");
  await attempt("10.00");
  expect(posts()).toHaveLength(2);
  expect(posts()[0].body).toEqual(posts()[1].body);
  expect(Object.keys(posts()[0].body).sort()).toEqual([
    "idempotencyKey",
    "principalCents",
  ]);
  expect(posts()[0].body.principalCents).toBe(1000);
  await attempt("10.01");
  expect(posts()[2].body.idempotencyKey).not.toBe(
    posts()[0].body.idempotencyKey,
  );
  await openCustom();
  await attempt("0010.00");
  expect(posts()[3].body).toEqual(posts()[0].body);
  await openCustom(PAGE.replace("org-1", "org-2"));
  await attempt("10.00");
  expect(posts()[4].body.idempotencyKey).not.toBe(
    posts()[0].body.idempotencyKey,
  );
  const anotherUserPage = await page.context().newPage();
  const anotherUser = await setup(anotherUserPage, {
    userId: "billing-admin-2",
    checkoutFailures: 1,
  });
  await anotherUserPage.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, value),
    {
      key: "polis.textingCheckout.billing-admin:org-1.custom:1000",
      value: posts()[0].body.idempotencyKey,
    },
  );
  await anotherUserPage.goto(PAGE);
  await anotherUserPage
    .getByRole("button", { name: "Add texting funds", exact: true })
    .click();
  await anotherUserPage
    .getByRole("button", { name: "Other", exact: true })
    .click();
  await anotherUserPage
    .getByRole("textbox", { name: "Amount in dollars" })
    .fill("10");
  await anotherUserPage.getByRole("checkbox").check();
  await anotherUserPage
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(anotherUserPage.getByRole("alert")).toContainText(
    "Retry to recover the same purchase",
  );
  expect(
    anotherUser.calls.find((call) => call.method === "POST").body
      .idempotencyKey,
  ).not.toBe(posts()[0].body.idempotencyKey);
  await anotherUserPage.close();
  state.status = "funded";
  state.funds = 10000000;
  await page.goto(`${PAGE}?purchase=purchase_1&checkout=returned`);
  await expect(page.getByTestId("texting-purchase-status")).toContainText(
    "$10.00 was added",
  );
  await expect(page.getByTestId("texting-available")).toHaveText("$10.00");
  const keys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(keys).not.toContain(
    "polis.textingCheckout.billing-admin:org-1.custom:1000",
  );
  expect(keys).toContain(
    "polis.textingCheckout.billing-admin:org-1.custom:1001",
  );
  expect(keys).toContain(
    "polis.textingCheckout.billing-admin:org-2.custom:1000",
  );
  state.status = "pending";
  await openCustom();
  await attempt("10");
  expect(posts()[5].body.idempotencyKey).not.toBe(
    posts()[0].body.idempotencyKey,
  );
  state.denied = true;
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.getByRole("alert")).toContainText("do not have access");
  await expect(
    page.getByRole("textbox", { name: "Amount in dollars" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue to secure checkout" }),
  ).toHaveCount(0);
  expect(posts()).toHaveLength(6);
});
