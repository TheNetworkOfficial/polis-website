import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const directory = new URL(
  "../frontend/src/pages/shared-feed/",
  import.meta.url,
);
const source = await readFile(new URL("shared-feed.js", directory), "utf8");
const moduleSource = await readFile(
  new URL("scripts/montanaCandidateOffices.js", directory),
  "utf8",
);
const offices = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`
);
const builderSource = await readFile(
  new URL("scripts/territoryBuilderModel.js", directory),
  "utf8",
);
const { decodeTerritoryBuilderGeometry } = await import(
  `data:text/javascript;base64,${Buffer.from(builderSource).toString("base64")}`
);

function extract(name) {
  const start = source.search(
    new RegExp(`^(?:async )?function ${name}\\(`, "m"),
  );
  assert.notEqual(start, -1, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, start + 1 + next);
}

const functions = [
  "createCandidateAccessDraft",
  "candidateAccessFullName",
  "normalizeCandidateAccessEin",
  "candidateAccessOfficeOptions",
  "isCandidateAccessFederal",
  "isCandidateAccessState",
  "isCandidateAccessCounty",
  "isCandidateAccessCity",
  "candidateAccessNeedsState",
  "candidateAccessNeedsDistrict",
  "candidateAccessUsesFederalDistrictOptions",
  "candidateAccessDistrictValueForOption",
  "candidateAccessDistrictLabelForOption",
  "candidateAccessResetFederalDistricts",
  "loadCandidateAccessFederalDistrictOptions",
  "refreshCandidateAccessFederalDistrictOptions",
  "candidateAccessApplyOfficeDefaults",
  "candidateAccessDraftFromForm",
  "updateCandidateAccessDraftField",
  "candidateAccessApiLevel",
  "candidateAccessLegalEntityPayloadFromDraft",
  "candidateAccessFormattedLegalAddress",
  "candidateAccessPayloadFromDraft",
  "validateCandidateAccessNameDraft",
  "candidateAccessHttpsUrlIsValid",
  "validateCandidateAccessLegalEntityDraft",
  "validateCandidateAccessDraft",
  "normalizeCandidateAccessApplication",
  "candidateAccessApplicationSummaryFromSubmission",
  "submitCandidateAccessApplication",
  "candidateAccessFieldAttrs",
  "renderCandidateAccessOfficeSelect",
  "renderCandidateAccessStateSelect",
  "renderMontanaCandidateScopeFields",
  "renderCandidateAccessConditionalFields",
  "normalizeStateJurisdiction",
  "candidateDisplayDistrictLabel",
  "normalizeElectionRaceType",
  "electionRaceTypeLabel",
  "normalizeElectionLegislativeDistrictId",
];

function setup(
  office = "Public Service Commissioner",
  { district = "1", seat = "", request } = {},
) {
  const resource = {
    draft: {},
    federalDistricts: { items: [], loading: false },
    actionPendingKey: "",
    error: "",
    notice: "",
  };
  const state = {
    auth: { user: { userId: "actor-a" }, session: {} },
    pages: { settings: { candidateAccess: resource } },
  };
  const calls = [],
    messages = [];
  const context = vm.createContext({
    ...offices,
    root: null,
    state,
    URL,
    URLSearchParams,
    normalizeString: (value) => String(value ?? "").trim(),
    readObjectPayload: (value) =>
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    readArrayPayload: (value, keys) =>
      keys.map((key) => value[key]).find(Array.isArray) || [],
    formStringValue: (form, key, fallback) =>
      form.has(key) ? form.get(key) : fallback,
    escapeHtml: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
    selectedAttr: (selected) => (selected ? " selected" : ""),
    disabledAttr: (disabled) => (disabled ? " disabled" : ""),
    SETTINGS_US_STATES: [
      ["MT", "Montana"],
      ["WA", "Washington"],
    ],
    ELECTION_STATE_RACE_TYPES: [
      "statewide",
      "house",
      "senate",
      "public_service_commission",
      "judicial",
    ],
    scheduleRender: () => {},
    showToast: (value) => messages.push(value),
    settingsErrorMessage: (error) => error.message,
    settingsHomeLocationErrorMessage: (error) => error.message,
    normalizeSettingsCongressionalDistrictOption: (value) => value,
    fetchJson: async (path, options) => {
      calls.push({ path, options });
      return request
        ? request(path, options)
        : { applicationId: "application-one", status: "pending" };
    },
  });
  const constants = source.slice(
    source.indexOf("const CANDIDATE_ACCESS_LEVEL_FEDERAL ="),
    source.indexOf("const CANDIDATE_ACCESS_LEGAL_ENTITY_HELP ="),
  );
  vm.runInContext(
    constants + "\n" + functions.map(extract).join("\n"),
    context,
  );
  resource.draft = context.createCandidateAccessDraft({
    firstName: "Ada",
    lastName: "Candidate",
    level: "State",
    state: "MT",
    office,
    district,
    seat,
    legalEntityLegalName: "Candidate Committee",
    legalEntityEin: "123456789",
    legalEntityAddressLine1: "100 Test Street",
    legalEntityCity: "Helena",
    legalEntityRegion: "MT",
    legalEntityPostalCode: "59601",
    legalEntityRepresentativeFirstName: "Ada",
    legalEntityRepresentativeLastName: "Candidate",
    legalEntityRepresentativeTitle: "Treasurer",
    legalEntityRepresentativeEmail: "candidate@example.invalid",
    legalEntityRepresentativePhone: "+14065550100",
    legalEntityAuthorityName: "Montana",
    legalEntityRegistrationId: "fixture-id",
    legalEntityFilingUrl: "https://example.invalid/filing",
    legalEntityWebsiteUrl: "https://example.invalid/campaign",
  });
  return { context, state, resource, calls, messages };
}

for (const office of offices.montanaStateOffices) {
  test(`${office} validates and submits its Montana office scope`, async () => {
    const spec = offices.montanaCandidateOfficeSpec({
      office,
      level: "State",
      state: "MT",
      district: "1",
    });
    const { context, resource, calls } = setup(office, {
      district: spec.maxDistrict ? "1" : "",
      seat: spec.requiresSeat ? "1" : "",
    });
    assert.equal(context.validateCandidateAccessDraft(resource.draft), "");
    assert.equal(
      await context.submitCandidateAccessApplication(new Map()),
      true,
    );
    const payload = calls[0].options.body;
    assert.equal(payload.office, office);
    assert.equal(payload.level, "state");
    assert.equal(payload.state, "MT");
    assert.equal(payload.district, spec.maxDistrict ? "1" : "statewide");
    assert.equal(payload.seat, spec.requiresSeat ? "1" : undefined);
    assert.equal(payload.fecCandidateId, undefined);
    assert.equal(
      payload.legalEntityProfile.committeeClassification,
      "candidate_committee",
    );
    assert.equal(resource.application.seat, spec.requiresSeat ? "1" : "");
  });
}

test("missing, malformed and wrong-office districts fail closed", () => {
  for (const [office, max] of [
    ["State Representative", 100],
    ["State Senator", 50],
    ["Public Service Commissioner", 5],
    ["District Court Judge", 22],
  ]) {
    for (const district of [
      "",
      "0",
      String(max + 1),
      "statewide",
      "abc",
      "+1",
      "0x1",
    ]) {
      const { context, resource } = setup(office, {
        district,
        seat: office === "District Court Judge" ? "1" : "",
      });
      assert.notEqual(
        context.validateCandidateAccessDraft(resource.draft),
        "",
        `${office}: ${district}`,
      );
    }
  }
  assert.notEqual(
    offices.validateMontanaCandidateScope({
      level: "state",
      state: "MT",
      office: "Treasurer",
    }),
    "",
  );
});

test("Montana 2028 election cycle is sent and retained in the application summary", async () => {
  const { context, resource, calls } = setup("Public Service Commissioner", {
    district: "5",
  });
  context.updateCandidateAccessDraftField("electionCycle", "2028");
  assert.match(
    context.renderCandidateAccessConditionalFields(resource.draft, false),
    /Election cycle year \(optional\)/,
  );
  assert.equal(await context.submitCandidateAccessApplication(new Map()), true);
  assert.equal(calls[0].options.body.electionCycle, "2028");
  assert.equal(resource.application.electionCycle, "2028");
});

test("optional Montana election cycle survives cleared and restored form drafts", () => {
  const { context, resource } = setup("District Court Judge", {
    district: "13",
    seat: "10",
  });
  context.updateCandidateAccessDraftField("electionCycle", "2028");
  const saved = context.candidateAccessDraftFromForm(new Map(), resource.draft);
  assert.equal(saved.electionCycle, "2028");
  const cleared = context.candidateAccessDraftFromForm(
    new Map([["electionCycle", ""]]),
    saved,
  );
  const restored = context.candidateAccessDraftFromForm(new Map(), cleared);
  assert.equal(restored.electionCycle, "");
  assert.equal(context.validateCandidateAccessDraft(restored), "");
  assert.equal(
    context.candidateAccessPayloadFromDraft(restored).electionCycle,
    undefined,
  );
  assert.equal(restored.district, "13");
  assert.equal(restored.seat, "10");
});

test("supplied Montana election cycle must use the server's supported year range", async () => {
  const currentYear = new Date().getUTCFullYear();
  for (const year of [
    "202",
    "2028x",
    "+2028",
    String(currentYear - 3),
    String(currentYear + 9),
  ]) {
    const { context, resource, calls } = setup();
    resource.draft.electionCycle = year;
    assert.match(
      context.validateCandidateAccessDraft(resource.draft),
      /Enter an election cycle year from/,
    );
    assert.equal(
      await context.submitCandidateAccessApplication(new Map()),
      false,
    );
    assert.equal(calls.length, 0);
  }
});

test("judicial department and statewide justice seat validation is precise", () => {
  for (const [district, max] of Object.entries(
    offices.montanaJudicialDepartments,
  )) {
    assert.equal(
      offices.validateMontanaCandidateScope({
        level: "state",
        state: "MT",
        office: "District Court Judge",
        district,
        seat: String(max),
      }),
      "",
    );
    assert.notEqual(
      offices.validateMontanaCandidateScope({
        level: "state",
        state: "MT",
        office: "District Court Judge",
        district,
        seat: String(max + 1),
      }),
      "",
    );
  }
  assert.equal(
    offices.validateMontanaCandidateScope({
      level: "state",
      state: "MT",
      office: "Supreme Court Justice",
      seat: "6",
    }),
    "",
  );
  assert.notEqual(
    offices.validateMontanaCandidateScope({
      level: "state",
      state: "MT",
      office: "Supreme Court Justice",
      seat: "7",
    }),
    "",
  );
});

test("selection changes clear district/seat and preserve generic other jurisdictions", () => {
  const { context, resource } = setup("District Court Judge", {
    district: "13",
    seat: "10",
  });
  context.updateCandidateAccessDraftField(
    "office",
    "Public Service Commissioner",
  );
  assert.equal(resource.draft.district, "");
  assert.equal(resource.draft.seat, "");
  context.updateCandidateAccessDraftField("district", "5");
  context.updateCandidateAccessDraftField("state", "WA");
  assert.equal(resource.draft.district, "");
  assert.equal(resource.draft.office, "");
  assert.ok(
    context
      .candidateAccessOfficeOptions("State", resource.draft)
      .includes("Treasurer"),
  );
  assert.ok(context.candidateAccessOfficeOptions("County").includes("Sheriff"));
  assert.ok(
    context.candidateAccessOfficeOptions("City/Township").includes("Mayor"),
  );
});

test("required PSC and court selects render bounded choices and joint-ticket context", () => {
  const { context, resource } = setup();
  const options = context.renderCandidateAccessOfficeSelect(
    resource.draft,
    false,
  );
  assert.match(
    options,
    /Montana State House|Montana State Senate|Montana Public Service Commission/,
  );
  assert.doesNotMatch(options, /Other \(specify\)|Treasurer/);
  const psc = context.renderCandidateAccessConditionalFields(
    resource.draft,
    false,
  );
  assert.match(psc, /name="district"[^>]*required/);
  assert.match(psc, /District 5/);
  assert.doesNotMatch(psc, /District 6|FEC candidate ID/);
  const court = context.renderMontanaCandidateScopeFields(
    {
      ...resource.draft,
      office: "District Court Judge",
      district: "13",
      seat: "10",
    },
    false,
  );
  assert.match(court, /Department 10/);
  assert.doesNotMatch(court, /Department 11/);
  assert.match(
    context.renderMontanaCandidateScopeFields(
      { ...resource.draft, office: "Governor", district: "" },
      false,
    ),
    /joint ticket/,
  );
});

test("failed/repeated submissions preserve draft and allow a successful retry", async () => {
  let release,
    fail = true;
  const { context, resource, calls } = setup("Public Service Commissioner", {
    request: () =>
      fail
        ? new Promise((resolve, reject) => {
            release = reject;
          })
        : Promise.resolve({ status: "pending" }),
  });
  const submission = context.submitCandidateAccessApplication(new Map());
  assert.equal(
    await context.submitCandidateAccessApplication(new Map()),
    false,
  );
  assert.equal(calls.length, 1);
  release(new Error("Synthetic failure"));
  assert.equal(await submission, false);
  assert.equal(resource.draft.district, "1");
  assert.equal(resource.draft.legalEntityEin, "123456789");
  fail = false;
  assert.equal(await context.submitCandidateAccessApplication(new Map()), true);
  assert.equal(calls.length, 2);
});

test("rerendered drafts remain submit-compatible while actor changes discard late results", async () => {
  let release;
  const fixture = setup("Supreme Court Justice", {
    district: "",
    seat: "6",
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const submission = fixture.context.submitCandidateAccessApplication(
    new Map(),
  );
  fixture.resource.draft = fixture.context.candidateAccessApplyOfficeDefaults(
    fixture.resource.draft,
  );
  release({ status: "pending" });
  assert.equal(await submission, true);
  const next = setup("Public Service Commissioner", {
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const interrupted = next.context.submitCandidateAccessApplication(new Map());
  next.state.auth.user.userId = "actor-b";
  release({ status: "pending" });
  assert.equal(await interrupted, false);
  assert.equal(next.resource.application, undefined);
  assert.equal(next.resource.draft.legalEntityEin, "123456789");
  assert.deepEqual(next.messages, []);
});

test("late federal district response cannot alter selected Montana scope", async () => {
  let release;
  const { context, resource } = setup("U.S. Representative", {
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  resource.draft.level = "Federal";
  const pending = context.loadCandidateAccessFederalDistrictOptions("MT");
  context.updateCandidateAccessDraftField("level", "State");
  context.updateCandidateAccessDraftField(
    "office",
    "Public Service Commissioner",
  );
  release({
    districts: [
      {
        stateId: "MT",
        congressionalDistrictId: "2",
        congressionalDistrictCode: "2",
      },
    ],
  });
  await pending;
  assert.equal(resource.draft.office, "Public Service Commissioner");
  assert.equal(resource.draft.district, "");
  assert.equal(resource.federalDistricts.items.length, 0);
});

test("profile, My Districts and election routes preserve distinct Montana geography", () => {
  const { context } = setup();
  const data = context.normalizeStateJurisdiction({
    pscDistrictId: "MT-PSC-5",
    pscDistrictName: "PSC District 5",
    judicialDistrictId: "MT-JD-13",
    judicialDistrictName: "Judicial District 13",
  });
  assert.equal(data.pscDistrictId, "MT-PSC-5");
  assert.equal(data.judicialDistrictId, "MT-JD-13");
  assert.equal(
    context.candidateDisplayDistrictLabel({
      state: "MT",
      levelOfOffice: "state",
      officeTitle: "District Court Judge",
      district: "13",
      seat: "10",
    }),
    "MT Judicial district 13 · Department 10",
  );
  assert.equal(
    context.normalizeElectionRaceType("public_service_commission"),
    "public_service_commission",
  );
  assert.equal(
    context.normalizeElectionLegislativeDistrictId(
      "5",
      "MT",
      "public_service_commission",
    ),
    "MT-PSC-5",
  );
  assert.equal(
    context.normalizeElectionLegislativeDistrictId(
      "MT-HD-5",
      "MT",
      "public_service_commission",
    ),
    "",
  );
});

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ],
  ],
};
const reference = "a".repeat(64);
test("map outline projects every vertex and preserves holes/multiple polygons", () => {
  const path = offices.candidateBoundarySvgPath(
    {
      type: "MultiPolygon",
      coordinates: [polygon.coordinates, polygon.coordinates],
    },
    { west: 0, east: 4, south: 0, north: 4 },
  );
  assert.equal(path, "M5,95L95,95L95,5L5,5L5,95ZM5,95L95,95L95,5L5,5L5,95Z");
  assert.equal(offices.candidateBoundarySvgPath(polygon, null), "");
});

test("builder exact geometry references expand before parsing without source mutation", () => {
  const input = {
    geometryRefs: { [reference]: polygon },
    boundary: { geometryRef: reference },
    areas: [{ geojson: { geometryRef: reference } }],
  };
  const decoded = decodeTerritoryBuilderGeometry(input);
  assert.deepEqual(decoded.boundary, polygon);
  assert.deepEqual(decoded.areas[0].geojson, polygon);
  decoded.boundary.coordinates[0][0][0] = 99;
  assert.equal(input.geometryRefs[reference].coordinates[0][0][0], 0);
  assert.equal(decoded.areas[0].geojson.coordinates[0][0][0], 0);
  assert.equal(decodeTerritoryBuilderGeometry(polygon), polygon);
});

test("missing, malformed and unclosed builder geometry references fail closed", () => {
  for (const payload of [
    { geometryRefs: {}, boundary: { geometryRef: reference } },
    {
      geometryRefs: { [reference]: polygon },
      boundary: { geometryRef: reference, coordinates: [] },
    },
    {
      geometryRefs: { [reference]: { geometryRef: reference } },
      boundary: { geometryRef: reference },
    },
    {
      geometryRefs: {
        [reference]: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
            ],
          ],
        },
      },
      boundary: { geometryRef: reference },
    },
  ])
    assert.throws(
      () => decodeTerritoryBuilderGeometry(payload),
      /geometry_unavailable/,
    );
});
