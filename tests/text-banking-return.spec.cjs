const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9016";

const cases = [
  {
    path: "/text-banking/billing/success",
    heading: "Checkout complete",
    detail: "tap Refresh status to confirm your subscription",
  },
  {
    path: "/text-banking/billing",
    heading: "Return to Polis",
    detail: "tap Refresh status to review your current billing state",
  },
  {
    path: "/text-banking/registration-payment/success",
    heading: "Payment checkout complete",
    detail: "tap Refresh status to continue sender setup",
  },
  {
    path: "/text-banking/registration-payment",
    heading: "Return to sender setup",
    detail: "tap Refresh status to review or retry the payment",
  },
];

test("Stripe text-banking returns render a safe mobile handoff", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });

  for (const [index, routeCase] of cases.entries()) {
    const sentinel = `session-secret-${index}`;
    const response = await page.goto(
      `${BASE_URL}${routeCase.path}?session_id=${encodeURIComponent(sentinel)}`,
    );

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: routeCase.heading }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText(routeCase.detail);
    await expect(page.locator("main")).toContainText("Stripe's signed webhook");
    await expect(page.locator("main")).toContainText(
      "You can safely close this browser tab.",
    );
    await expect(page.locator("body")).not.toContainText(sentinel);
    await expect(page.locator("body")).not.toContainText("404");
    await expect(page).toHaveURL(`${BASE_URL}${routeCase.path}`);

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 2,
    );
  }

  const unexpectedResponse = await page.goto(
    `${BASE_URL}/text-banking/billing/unexpected`,
  );
  expect(unexpectedResponse?.status()).toBe(404);
});
