import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/textingFundingAmount.js",
    import.meta.url,
  ),
);
const { customFundingConfig, customFundingQuote, fundingRetryAmount } =
  await import(`data:text/javascript;base64,${source.toString("base64")}`);
const policy = {
  minimumCents: 1000,
  maximumCents: 200000,
  serviceFeeBasisPoints: 500,
};

test("custom funding parses dollars exactly and rounds only the service fee half up", () => {
  for (const [text, principalCents, serviceFeeCents] of [
    ["10", 1000, 50],
    ["10.00", 1000, 50],
    ["010.0", 1000, 50],
    [" 10.01 ", 1001, 50],
    ["10.10", 1010, 51],
    ["12.50", 1250, 63],
    ["2000", 200000, 10000],
  ])
    assert.deepEqual(customFundingQuote(text, policy), {
      quote: {
        id: "custom",
        principalCents,
        serviceFeeCents,
        totalBeforeTaxCents: principalCents + serviceFeeCents,
      },
    });
});

test("invalid and out-of-range amounts cannot produce a purchase quote", () => {
  for (const text of [
    "",
    " ",
    "9.99",
    "0",
    "-10",
    "+10",
    "1e2",
    "NaN",
    "Infinity",
    "10.001",
    "10.",
    ".10",
    "1,000",
    "$10",
    "1 0",
    "2000.01",
    "99999999999999999999999999999",
    10,
    null,
    Infinity,
  ])
    assert.equal(
      customFundingQuote(text, policy).quote,
      undefined,
      String(text),
    );
  assert.equal(customFundingQuote("9.99", policy).error, "minimum");
  assert.equal(customFundingQuote("2000.01", policy).error, "maximum");
});

test("server limits control the quote, and missing or unsupported policy fails closed", () => {
  assert.equal(
    customFundingQuote("2500", { ...policy, maximumCents: 300000 }).quote
      .principalCents,
    250000,
  );
  for (const config of [
    null,
    {},
    { ...policy, minimumCents: 1 },
    { ...policy, maximumCents: 999 },
    { ...policy, serviceFeeBasisPoints: 501 },
    { ...policy, maximumCents: Infinity },
  ]) {
    assert.equal(customFundingConfig(config), null);
    assert.equal(customFundingQuote("10", config).error, "unavailable");
  }
  assert.equal(
    customFundingQuote("90071992547409.91", {
      ...policy,
      maximumCents: Number.MAX_SAFE_INTEGER,
    }).error,
    "maximum",
  );
});

test("custom retries and terminal cleanup share the same normalized amount identity", () => {
  for (const value of ["10", "10.0", "10.00", "010.00"]) {
    const { quote } = customFundingQuote(value, policy);
    assert.equal(
      fundingRetryAmount({ packId: quote.id, ...quote }),
      "custom:1000",
    );
  }
  assert.equal(
    fundingRetryAmount({ packId: "custom", principalCents: 1001 }),
    "custom:1001",
  );
  assert.equal(fundingRetryAmount({ packId: "usd_100" }), "usd_100");
  assert.equal(fundingRetryAmount({ packId: "custom" }), "");
});
