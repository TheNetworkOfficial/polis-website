import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const {
  availablePersonalization,
  personalizationPreview,
  insertPersonalization,
  personalizationFields,
} = await import(await moduleUrl("textingPersonalization"));
const { estimateContactCampaign } = await import(
  await moduleUrl("textingCampaignEstimate")
);
const { customerText, smsSegments } = await import(
  await moduleUrl("textingWorkspaceUi")
);
const policy = {
  version: 1,
  fields: personalizationFields.map((field) => field.name),
};

test("only advertised v1 fields appear in the picker", () => {
  assert.equal(availablePersonalization(policy).length, 5);
  for (const invalid of [
    null,
    {},
    { ...policy, version: 2 },
    { version: 1, fields: "first_name" },
  ])
    assert.deepEqual(availablePersonalization(invalid), []);
  assert.deepEqual(
    availablePersonalization({ version: 1, fields: ["city", "unknown"] }).map(
      (field) => field.name,
    ),
    ["city"],
  );
});
test("examples use only fictional values and expose the exact missing-value fallbacks", () => {
  const result = personalizationPreview(
    "Hi {{first_name}} {{last_name}} ({{full_name}}) in {{city}}, {{state}}!",
    policy,
  );
  assert.equal(
    result.example,
    "Hi Alex Example (Alex Example) in Example City, MT!",
  );
  assert.equal(result.error, "");
  assert.deepEqual(
    result.fields.map((field) => field.fallback),
    ["there", "friend", "there", "your community", "your state"],
  );
  assert.equal(personalizationPreview(undefined, policy).example, "");
  assert.equal(
    personalizationPreview("{{first_name}}{{first_name}}", policy).example,
    "AlexAlex",
  );
});
test("unknown, malformed, case variants, unadvertised and legacy syntax are rejected", () => {
  for (const text of [
    "{{unknown}}",
    "{{ first_name }}",
    "{{First_Name}}",
    "{{first_name",
    "first_name}}",
    "{first_name}",
    "{{{first_name}}}",
    "[[first_name]]",
    "[[",
    "{{first_name}} }",
  ])
    assert.ok(personalizationPreview(text, policy).error, text);
  assert.match(
    personalizationPreview("{{first_name}}", null).error,
    /unavailable/,
  );
  assert.equal(
    personalizationPreview("Ordinary message. Reply STOP to opt out.", null)
      .error,
    "",
  );
});
test("insertion preserves the exact surrounding text and selection, including Unicode", () => {
  assert.deepEqual(
    insertPersonalization("Hi friend!", "first_name", 3, 9, policy),
    { value: "Hi {{first_name}}!", caret: 17 },
  );
  assert.deepEqual(insertPersonalization("👋 !", "city", 3, 3, policy), {
    value: "👋 {{city}}!",
    caret: 11,
  });
  assert.equal(insertPersonalization("hello", "unknown", 0, 0, policy), null);
  assert.equal(insertPersonalization("hello", "city", 0, 0, null), null);
  assert.equal(
    insertPersonalization("x".repeat(1600), "city", 1600, 1600, policy),
    null,
  );
  assert.equal(
    insertPersonalization("x".repeat(1600), "city", 0, 8, policy).value.length,
    1600,
  );
});
test("personalized SMS does not multiply fictional or token length into a campaign total", () => {
  const billing = {
    rateStatus: "verified",
    smsUpToTwoSegmentsMicros: 35000,
    smsAdditionalSegmentMicros: 15000,
    mmsMicros: 45000,
  };
  const selected = { eligibleCount: 100000, status: "ready" };
  for (const text of [
    "Hi {{first_name}}",
    "👋 {{full_name}}",
    "x".repeat(306) + "{{city}}",
    "{{unknown}}",
  ])
    assert.deepEqual(estimateContactCampaign(billing, selected, true, text), {
      count: 100000,
      rate: null,
      total: null,
      segments: null,
      personalized: true,
    });
  assert.equal(
    estimateContactCampaign(billing, selected, true, "Hi {{first_name}}", true)
      .total,
    4500000000,
  );
  assert.equal(
    estimateContactCampaign(billing, selected, true, "hello").total,
    3500000000,
  );
  assert.equal(
    smsSegments(
      personalizationPreview("😀".repeat(34) + "{{first_name}}", policy)
        .example,
    ),
    2,
  );
});
test("server personalization errors give usable instructions without exposing codes", () => {
  assert.match(
    customerText("texting_personalization_reprepare_required"),
    /Create a new campaign/,
  );
  assert.match(
    customerText("texting_personalization_value_invalid"),
    /new campaign/,
  );
  for (const code of [
    "texting_template_invalid",
    "texting_merge_field_unknown",
    "texting_merge_syntax_invalid",
    "texting_personalization_unavailable",
    "texting_message_too_long",
  ])
    assert.ok(!customerText(code).includes("texting_"));
  assert.equal(customerText("toString"), "toString");
  assert.equal(customerText(0), "0");
});
