/** Only advertise custom funding when the server supplies the supported policy. */
export function customFundingConfig(value) {
  return value &&
    Number.isSafeInteger(value.minimumCents) &&
    value.minimumCents >= 1000 &&
    Number.isSafeInteger(value.maximumCents) &&
    value.maximumCents >= value.minimumCents &&
    value.serviceFeeBasisPoints === 500
    ? value
    : null;
}

/** Parse dollar text exactly; never round an entered fraction or accept exponents. */
export function customFundingQuote(value, policy) {
  const config = customFundingConfig(policy);
  if (!config) return { error: "unavailable" };
  if (typeof value !== "string" || !value.trim()) return { error: "empty" };
  const text = value.trim();
  if (text.length > 20 || !/^\d+(?:\.\d{1,2})?$/.test(text))
    return { error: "format" };
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents < BigInt(config.minimumCents)) return { error: "minimum" };
  if (cents > BigInt(config.maximumCents)) return { error: "maximum" };
  // Five percent, rounded to the nearest cent, with half cents rounded up.
  const fee = (cents + 10n) / 20n;
  if (cents + fee > BigInt(Number.MAX_SAFE_INTEGER))
    return { error: "maximum" };
  return {
    quote: {
      id: "custom",
      principalCents: Number(cents),
      serviceFeeCents: Number(fee),
      totalBeforeTaxCents: Number(cents + fee),
    },
  };
}

/** The same custom amount keeps its retry key, regardless of dollar formatting. */
export function fundingRetryAmount(purchase) {
  if (purchase?.packId !== "custom") return purchase?.packId || "";
  return Number.isSafeInteger(purchase.principalCents) &&
    purchase.principalCents > 0
    ? `custom:${purchase.principalCents}`
    : "";
}
