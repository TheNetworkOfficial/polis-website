/** Presentation metadata only. All matching remains in the authorized contact API. */
export const contactPageSizes = [10, 25, 50, 100];
export const contactStateOptions = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
  ["AS", "American Samoa"],
  ["GU", "Guam"],
  ["MP", "Northern Mariana Islands"],
  ["PR", "Puerto Rico"],
  ["VI", "U.S. Virgin Islands"],
  ["UM", "U.S. Minor Outlying Islands"],
];
export const contactFilterCategories = [
  {
    id: "location",
    label: "Location & districts",
    icon: "location",
    groups: ["address", "geography"],
    fields: [
      "state",
      "stateHouseDistrict",
      "stateSenateDistrict",
      "congressionalDistrict",
      "precinct",
      "city",
      "county",
      "postalCode",
      "addressLine1",
      "addressLine2",
      "country",
    ],
  },
  {
    id: "texting",
    label: "Texting status",
    icon: "message",
    groups: ["consent", "contact"],
    fields: ["eligibility", "consentStatus", "phone", "email", "textMessage"],
  },
  {
    id: "tags",
    label: "Tags & uploads",
    icon: "tag",
    groups: [],
    fields: ["tags", "sources"],
  },
  {
    id: "outreach",
    label: "Outreach & activity",
    icon: "activity",
    groups: ["canvassing", "activity", "preferences"],
    fields: [],
  },
  {
    id: "voter",
    label: "Voter information",
    icon: "person",
    groups: ["voter"],
    fields: ["registrationStatus", "registrationId"],
  },
  {
    id: "custom",
    label: "Custom information",
    icon: "columns",
    groups: [],
    fields: [],
  },
  {
    id: "record",
    label: "Contact record",
    icon: "clock",
    groups: ["identity"],
    fields: ["status", "createdAt", "updatedAt"],
  },
];

export function contactCategoryFields(definitions, category) {
  const definition = contactFilterCategories.find(
    (item) => item.id === category,
  );
  if (!definition) return [];
  const special = new Set(
    contactFilterCategories.flatMap((item) => item.fields),
  );
  return definitions
    .filter((field) => {
      if (category === "custom")
        return field.custom === true || field.fieldId.startsWith("tag_group:");
      if (definition.fields.includes(field.fieldId)) return true;
      if (field.custom || special.has(field.fieldId)) return false;
      return definition.groups.includes(
        String(field.group || "").toLowerCase(),
      );
    })
    .sort((a, b) => {
      const rank = (field) => {
        const index = definition.fields.indexOf(field.fieldId);
        return index < 0 ? 100 : index;
      };
      return rank(a) - rank(b) || a.label.localeCompare(b.label);
    });
}

export function contactFilterCount(filter) {
  if (!filter) return 0;
  return filter.conditions
    ? filter.conditions.reduce(
        (sum, child) => sum + contactFilterCount(child),
        0,
      )
    : 1;
}

/** Extract only independent AND leaves. Nested logic is retained verbatim for advanced editing. */
export function splitContactFilter(filter, definitions) {
  const allowed = new Set(definitions.map((field) => field.fieldId));
  const simple = {},
    remaining = [];
  const children =
    filter?.op === "and" ? filter.conditions : filter ? [filter] : [];
  for (const condition of children) {
    if (
      !condition.conditions &&
      allowed.has(condition.field) &&
      !simple[condition.field] &&
      [
        "eq",
        "contains",
        "in",
        "any",
        "exists",
        "gt",
        "gte",
        "lt",
        "lte",
      ].includes(condition.op)
    ) {
      simple[condition.field] = structuredClone(condition);
    } else remaining.push(structuredClone(condition));
  }
  const advanced = remaining.length
    ? filter?.op === "and"
      ? { op: "and", conditions: remaining }
      : remaining[0]
    : null;
  return { simple, advanced };
}

export function combineContactFilters(simple, advanced) {
  const conditions = Object.values(simple).filter((condition) => {
    const value = condition.value;
    return Array.isArray(value)
      ? value.length > 0
      : value !== "" && value != null;
  });
  if (advanced)
    conditions.push(
      ...(advanced.op === "and" ? advanced.conditions : [advanced]),
    );
  return conditions.length ? { op: "and", conditions } : null;
}

const paths = {
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort: '<path d="M8 3v18m-4-4 4 4 4-4M15 5h6m-6 5h4m-4 5h2"/>',
  columns:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  location:
    '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  message: '<path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z"/>',
  tag: '<path d="m21 12-9 9L2 11V2h9z"/><circle cx="7" cy="7" r="1"/>',
  activity: '<path d="M4 21h16M7 21V3h10v18M14 12h.1"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh:
    '<path d="M4 9a8 8 0 0 1 14-4l2 2m0-5v5h-5M20 15a8 8 0 0 1-14 4l-2-2m0 5v-5h5"/>',
};
export const contactIcon = (name) =>
  `<svg class="pt-cb-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.columns}</svg>`;
