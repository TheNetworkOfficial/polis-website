const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const PAGE = `${BASE_URL}/organizations/org-1/texting-balance`;
const API = "/api/text-banking/prompt/scopes/coalition%3Aorg-1/billing/";

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
      token: jwt({ sub: "billing-admin", email: "billing@example.test" }),
    },
  );
  const purchase = () => ({
    purchaseId: "purchase_1",
    packId: "usd_100",
    status: state.status,
    principalCents: 10000,
    serviceFeeCents: 500,
    taxCents: state.status === "funded" ? 210 : null,
    totalCents: state.status === "funded" ? 10710 : null,
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
    if (!url.pathname.startsWith(API)) return respond({});
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
          canPurchase: state.admin,
          sendingBlocked: state.funds === 0,
          billingHold: null,
          blockedReasons: [],
          environment: "test",
          packs: [100, 250, 500, 1000, 2000].map((amount) => ({
            id: `usd_${amount}`,
            principalCents: amount * 100,
            serviceFeeCents: amount * 5,
            totalBeforeTaxCents: amount * 105,
          })),
          terms: {
            version: "texting-payments-2026-09-19",
            url: "https://polisapp.io/texting-payment-terms",
            supportEmail: "support@example.test",
            taxNotice: "Applicable tax is calculated in checkout.",
            refundPolicy: "No routine refunds.",
          },
        },
      });
    if (url.pathname.endsWith("checkouts")) {
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
    "$0.015 per additional SMS segment",
  );
  await expect(
    page
      .getByTestId("texting-purchase-status")
      .getByRole("link", { name: "View receipt" }),
  ).toHaveAttribute("href", "https://pay.stripe.com/receipts/example");
  await expect(page.locator(".texting-balance__history")).toContainText(
    "Fee $5.00 · Tax $2.10 · Total $107.10",
  );
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

test("members cannot purchase or request history, and revoked access clears financial details", async ({
  page,
}) => {
  const { state, calls } = await setup(page, {
    admin: false,
    funds: 100000000,
  });
  await page.goto(`${PAGE}?purchase=purchase_1&checkout=returned`);
  await expect(page.getByTestId("texting-available")).toHaveText("$100.00");
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
