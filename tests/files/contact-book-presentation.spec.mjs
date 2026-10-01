import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/organizationContactPresentation.js",
    import.meta.url,
  ),
);
const {
  contactPageSizes,
  contactStateOptions,
  contactCategoryFields,
  contactFilterCount,
  splitContactFilter,
  combineContactFilters,
} = await import(`data:text/javascript;base64,${source.toString("base64")}`);
const modelSource = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/organizationContactsModel.js",
    import.meta.url,
  ),
);
test("state choices include all states, DC and territories with stable postal codes", () => {
  assert.equal(contactStateOptions.length, 57);
  assert.equal(new Set(contactStateOptions.map(([code]) => code)).size, 57);
  for (const entry of [
    ["MT", "Montana"],
    ["AZ", "Arizona"],
    ["DC", "District of Columbia"],
    ["AS", "American Samoa"],
    ["GU", "Guam"],
    ["MP", "Northern Mariana Islands"],
    ["PR", "Puerto Rico"],
    ["VI", "U.S. Virgin Islands"],
    ["UM", "U.S. Minor Outlying Islands"],
  ])
    assert.deepEqual(
      contactStateOptions.find(([code]) => code === entry[0]),
      entry,
    );
});
const { contactFilterValue } = await import(
  `data:text/javascript;base64,${modelSource.toString("base64")}`
);

const definitions = [
  { fieldId: "state", label: "State", group: "Address" },
  {
    fieldId: "stateHouseDistrict",
    label: "State House district",
    group: "Geography",
  },
  { fieldId: "city", label: "City", group: "Address" },
  { fieldId: "consentStatus", label: "Opt-in status", group: "Consent" },
  { fieldId: "eligibility", label: "Texting status" },
  { fieldId: "tags", label: "Tags" },
  { fieldId: "sources", label: "Uploads" },
  {
    fieldId: "doorKnock",
    label: "Door-knocking permission",
    group: "Preferences",
  },
  { fieldId: "recordedAt", label: "Last observation", group: "Canvassing" },
  { fieldId: "registrationStatus", label: "Registration", group: "Identity" },
  {
    fieldId: "custom_water",
    label: "Water district",
    group: "Address",
    custom: true,
  },
  {
    fieldId: "custom_tax",
    label: "Tax area code",
    group: "Identity",
    custom: true,
  },
  { fieldId: "tag_group:interests", label: "Interests" },
];
const eq = (field, value) => ({ field, op: "eq", value });

test("page sizes match the approved choices and include the 50-row default", () => {
  assert.deepEqual(contactPageSizes, [10, 25, 50, 100]);
});

test("categories use supplied schema fields and keep arbitrary imported fields in custom information", () => {
  const ids = (category) =>
    contactCategoryFields(definitions, category).map((field) => field.fieldId);
  assert.deepEqual(ids("location"), ["state", "stateHouseDistrict", "city"]);
  assert.deepEqual(ids("tags"), ["tags", "sources"]);
  assert.deepEqual(ids("texting"), ["eligibility", "consentStatus"]);
  assert.deepEqual(ids("custom"), [
    "tag_group:interests",
    "custom_tax",
    "custom_water",
  ]);
  assert.deepEqual(ids("voter"), ["registrationStatus"]);
  assert.deepEqual(ids("unknown"), []);
  assert(!ids("record").includes("custom_tax"));
  assert.deepEqual(
    contactCategoryFields(
      definitions.filter((field) => field.fieldId === "state"),
      "location",
    ),
    [definitions[0]],
  );
});

test("Montana House 22 can span every upload without adding an upload restriction", () => {
  const filter = combineContactFilters(
    {
      state: eq("state", "MT"),
      house: eq("stateHouseDistrict", "22"),
    },
    null,
  );
  assert.deepEqual(filter, {
    op: "and",
    conditions: [eq("state", "MT"), eq("stateHouseDistrict", "22")],
  });
  assert.equal(contactFilterCount(filter), 2);
  assert(!filter.conditions.some((condition) => condition.field === "sources"));
});

test("multiple selected uploads stay an OR membership inside the state-and-district filter", () => {
  const filter = combineContactFilters(
    {
      state: eq("state", "MT"),
      house: eq("stateHouseDistrict", "22"),
      sources: {
        field: "sources",
        op: "any",
        value: ["county", "signup", "door"],
      },
    },
    null,
  );
  assert.deepEqual(filter.conditions[2], {
    field: "sources",
    op: "any",
    value: ["county", "signup", "door"],
  });
  assert.equal(filter.op, "and");
});

test("opening simple filters preserves nested OR and NOT conditions from saved views", () => {
  const alternatives = {
    op: "or",
    conditions: [eq("tags", "volunteer"), eq("tags", "follow_up")],
  };
  const exclusion = {
    op: "not",
    conditions: [eq("consentStatus", "opted_out")],
  };
  const saved = {
    op: "and",
    conditions: [eq("state", "MT"), alternatives, exclusion],
  };
  const before = structuredClone(saved);
  const split = splitContactFilter(saved, definitions);
  assert.deepEqual(split.simple, { state: eq("state", "MT") });
  assert.deepEqual(split.advanced, {
    op: "and",
    conditions: [alternatives, exclusion],
  });
  assert.deepEqual(combineContactFilters(split.simple, split.advanced), saved);
  assert.deepEqual(saved, before);
  assert.equal(contactFilterCount(saved), 4);
});

test("a top-level OR is never flattened into an AND by simple filter editing", () => {
  const saved = {
    op: "or",
    conditions: [eq("state", "MT"), eq("state", "AZ")],
  };
  const split = splitContactFilter(saved, definitions);
  assert.deepEqual(split.simple, {});
  assert.deepEqual(split.advanced, saved);
  assert.deepEqual(combineContactFilters(split.simple, split.advanced), {
    op: "and",
    conditions: [saved],
  });
});

test("repeated field constraints retain both halves of a range", () => {
  const saved = {
    op: "and",
    conditions: [
      { field: "recordedAt", op: "gte", value: "2026-09-01" },
      { field: "recordedAt", op: "lt", value: "2026-10-01" },
    ],
  };
  const split = splitContactFilter(saved, definitions);
  assert.deepEqual(combineContactFilters(split.simple, split.advanced), saved);
});

test("unknown schema constraints stay explicit advanced constraints instead of disappearing", () => {
  const hidden = eq("unavailable_field", "retained");
  const split = splitContactFilter(hidden, definitions);
  assert.deepEqual(split.simple, {});
  assert.deepEqual(split.advanced, hidden);
});

test("false, numeric zero, leading zero identifiers and missing-field tests survive filter assembly", () => {
  const filter = combineContactFilters(
    {
      permission: eq("doorKnock", false),
      amount: eq("custom_amount", 0),
      tax: eq("custom_tax", "00420"),
      missing: { field: "phone", op: "exists", value: false },
      blank: eq("city", ""),
      emptyTags: { field: "tags", op: "any", value: [] },
      absent: eq("county", null),
    },
    null,
  );
  assert.deepEqual(
    filter.conditions.map((condition) => condition.value),
    [false, 0, "00420", false],
  );
  assert.equal(contactFilterCount(filter), 4);
  assert.equal(combineContactFilters({}, null), null);
  assert.equal(contactFilterCount(null), 0);
});

test("draft edits do not mutate the saved filter or its tag/source arrays", () => {
  const saved = {
    op: "and",
    conditions: [{ field: "sources", op: "any", value: ["county", "signup"] }],
  };
  const split = splitContactFilter(saved, definitions);
  split.simple.sources.value.push("door");
  assert.deepEqual(saved.conditions[0].value, ["county", "signup"]);
});

test("scalar comparisons against every membership type remain scalars, while in retains an array", () => {
  for (const type of [
    "multiple_choice",
    "multi_choice",
    "multiselect",
    "tags",
  ]) {
    const field = { fieldId: "sources", label: "Uploads", type };
    for (const op of ["eq", "neq", "contains"])
      assert.equal(contactFilterValue("source-1", field, op), "source-1");
    for (const op of ["in", "not_in"])
      assert.deepEqual(contactFilterValue("source-1,source-3", field, op), [
        "source-1",
        "source-3",
      ]);
  }
});
