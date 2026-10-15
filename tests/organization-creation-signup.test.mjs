import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { moduleUrl } from "./texting/module-fixture.mjs";
const {
  createOrganizationSignup,
  organizationSignupPayload,
  validateOrganizationSignup,
  renderOrganizationSignup,
} = await import(await moduleUrl("organizationCreationSignup"));
const TOKEN = "synthetic-invitation-token-" + "a".repeat(32);
const NOW = Date.parse("2026-10-15T12:00:00Z");
const fields = (extra = {}) =>
  new Map(
    Object.entries({
      name: "Fixture organization",
      description: "Synthetic organization",
      imageUrl: "https://example.invalid/image.png",
      orgKind: "coalition",
      coalitionType: "simple",
      pacAssociated: "false",
      fecNumber: "C12345678",
      legalName: "Fixture legal organization",
      ein: "12-3456789",
      committeeClassification: "non_political_organization",
      addressLine1: "100 Test Street",
      city: "Helena",
      region: "MT",
      postalCode: "59601",
      websiteUrl: "https://example.invalid/organization",
      representativeFirstName: "Ada",
      representativeLastName: "Example",
      representativeTitle: "Treasurer",
      representativeEmail: "ada@example.test",
      representativePhone: "+14065550100",
      registrationStatus: "not_applicable",
      notApplicableReason: "Not an election committee.",
      authorityName: "Fixture authority",
      registrationId: "fixture-registration",
      filingUrl: "https://example.invalid/filing",
      stateId: "MT",
      countyName: "Cascade County",
      partyLabel: "Democratic",
      partyAbbrev: "DEM",
      districtId: "HD-5",
      districtName: "House district 5",
      "social:facebook": "https://example.invalid/social",
      ...extra,
    }),
  );
function fixture(
  handler,
  { data = new Map(), savedContext, storageFailure = false } = {},
) {
  let current = savedContext || {
    actorId: "actor-a",
    path: "/organizations/signup",
  };
  const calls = [],
    navigations = [],
    replacements = [],
    timers = new Map();
  let timerId = 0,
    draftsCleared = 0;
  let clock = NOW;
  const storage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => {
      if (storageFailure) throw Error("unavailable");
      data.set(key, value);
    },
    removeItem: (key) => data.delete(key),
  };
  const pending = () => ({
    ok: true,
    invitation: {
      status: "pending",
      recipientEmail: "ada@example.test",
      expiresAt: new Date(NOW + 3600000).toISOString(),
    },
  });
  const page = createOrganizationSignup({
    context: () => current,
    storage,
    now: () => clock,
    uuid: () => "request-fixture-one",
    changed() {},
    clearDraft: () => draftsCleared++,
    navigate: (path) => navigations.push(path),
    schedule: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, { fn, delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
    request: async (path, options) => {
      options.beforeRequest();
      calls.push({ path, options });
      return handler ? handler(path, options, pending) : pending();
    },
  });
  const capture = (suffix = "") =>
    page.captureLocation(
      `https://example.invalid/organizations/signup?invitationToken=${TOKEN}${suffix}`,
      (path) => replacements.push(path),
    );
  return {
    page,
    calls,
    data,
    navigations,
    replacements,
    timers,
    capture,
    pending,
    advance: (duration) => {
      clock += duration;
    },
    context: (value) => {
      current = value;
    },
    draftsCleared: () => draftsCleared,
  };
}
const flush = () => new Promise(setImmediate);

for (const kind of [
  "coalition",
  "pac",
  "state_party",
  "county_party",
  "candidate_support",
])
  test(`${kind} retains complete native legal/org metadata`, () => {
    const body = organizationSignupPayload(fields({ orgKind: kind }));
    assert.equal(validateOrganizationSignup(body), "");
    assert.equal(body.orgKind, kind);
    assert.equal(body.legalEntityProfile.ein, "123456789");
    assert.equal(body.primaryContactName, "Ada Example");
    assert.equal(body.website, body.legalEntityProfile.websiteUrl);
    assert.equal(body.governanceType, kind === "coalition" ? "simple" : kind);
    if (kind === "state_party")
      assert.equal(
        body.legalEntityProfile.committeeClassification,
        "state_party_committee",
      );
    if (kind === "county_party") {
      assert.equal(body.jurisdiction.countyId, "MT-cascade");
      assert.equal(body.party.partyId, "DEM");
    }
    if (kind === "pac") {
      assert.equal(body.pacAssociated, true);
      assert.equal(
        body.legalEntityProfile.committeeClassification,
        "other_political_committee",
      );
    }
    if (kind === "candidate_support")
      assert.equal(body.districtScope.districtId, "HD-5");
  });

test("malformed legal and political registration details never submit", () => {
  for (const extra of [
    { ein: "123" },
    { websiteUrl: "http://example.invalid" },
    { representativePhone: "4065550100" },
    { orgKind: "pac", fecNumber: "" },
    { orgKind: "state_party", filingUrl: "" },
    { orgKind: "county_party", countyName: "" },
    { committeeClassification: "unknown" },
  ])
    assert.notEqual(
      validateOrganizationSignup(organizationSignupPayload(fields(extra))),
      "",
    );
});

test("missing token and unvalidated direct submissions issue no API calls", async () => {
  const h = fixture();
  await h.page.load();
  assert.equal(await h.page.submit(fields()), false);
  assert.equal(h.calls.length, 0);
  assert.match(renderOrganizationSignup(h.page.state()), /Invitation required/);
  assert.doesNotMatch(
    renderOrganizationSignup(h.page.state()),
    /<form|Create organization/,
  );
});

test("capture scrubs the token before login and restores only tab-scoped intent, never legal data", async () => {
  const h = fixture();
  h.capture("&orgKind=county_party");
  assert.deepEqual(h.replacements, [
    "/organizations/signup?orgKind=county_party",
  ]);
  const saved = JSON.parse([...h.data.values()][0]);
  assert.equal(saved.clientRequestId, "request-fixture-one");
  assert.equal(saved.actorId, null);
  assert.equal(saved.orgKind, "county_party");
  assert.doesNotMatch(JSON.stringify(h.page.state()), new RegExp(TOKEN));
  const restored = fixture(null, { data: h.data });
  restored.page.captureLocation(
    "https://example.invalid/organizations/signup",
    () => {},
  );
  await restored.page.load();
  assert.equal(restored.page.state().phase, "form");
  assert.equal(restored.page.state().orgKind, "county_party");
  assert.equal(JSON.parse([...h.data.values()][0]).actorId, "actor-a");
  assert.doesNotMatch(
    [...h.data.values()][0],
    /ein|legalName|authorizedRepresentative/,
  );
});

test("malformed/duplicate invitation parameters are erased and never validated", async () => {
  for (const query of [
    "invitationToken=short",
    `invitationToken=${TOKEN}&invitationToken=${TOKEN}`,
    `invitationToken=${TOKEN}&INVITATIONTOKEN=${TOKEN}`,
  ]) {
    const h = fixture();
    h.page.captureLocation(
      `https://example.invalid/coalitions/start?${query}`,
      (path) => h.replacements.push(path),
    );
    await h.page.load();
    assert.equal(h.calls.length, 0);
    assert.equal(h.replacements[0], "/coalitions/start");
    assert.equal(h.page.state().phase, "blocked");
  }
});

test("storage failure blocks creation without leaking or retaining the token in the URL", async () => {
  const h = fixture(null, { storageFailure: true });
  h.capture();
  await h.page.load();
  assert.equal(await h.page.submit(fields()), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.replacements[0], "/organizations/signup");
});

test("validation401 keeps the intent through explicit clean auth return", async () => {
  let unauthorized = true;
  const h = fixture(async (_path, _options, pending) => {
    if (unauthorized)
      throw Object.assign(Error("unauthorized"), { status: 401 });
    return pending();
  });
  h.capture();
  await h.page.load();
  assert.equal(h.page.state().requiresSignIn, true);
  assert.equal(h.data.size, 1);
  await h.page.action("organization-signup-sign-in");
  assert.deepEqual(h.navigations, ["/auth?returnTo=%2Forganizations%2Fsignup"]);
  unauthorized = false;
  await h.page.load({ force: true });
  assert.equal(h.page.state().phase, "form");
  assert.equal(
    h.calls.filter((call) => call.path === "/api/coalitions").length,
    0,
  );
});

for (const status of [403, 404])
  test(`authoritative invitation denial ${status} clears secret intent and never creates`, async () => {
    const h = fixture(async () => {
      throw Object.assign(
        Error("secret echoed by untrusted failure: " + TOKEN),
        { status },
      );
    });
    h.capture();
    await h.page.load();
    assert.equal(h.data.size, 0);
    assert.equal(h.page.state().phase, "blocked");
    assert.doesNotMatch(
      renderOrganizationSignup(h.page.state()),
      new RegExp(TOKEN),
    );
    assert.equal(await h.page.submit(fields()), false);
  });

test("single-flight validation and create require separate explicit actions", async () => {
  let resolveValidation, resolveCreation;
  const h = fixture(
    (path) =>
      new Promise((resolve) => {
        if (path.includes("validate")) resolveValidation = resolve;
        else resolveCreation = resolve;
      }),
  );
  h.capture();
  const opening = h.page.load();
  await flush();
  await h.page.load();
  assert.equal(h.calls.length, 1);
  resolveValidation(h.pending());
  await opening;
  assert.equal(h.calls.length, 1);
  const creating = h.page.submit(fields());
  await flush();
  assert.equal(await h.page.submit(fields()), false);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].options.body.invitationToken, TOKEN);
  assert.equal(h.calls[1].options.body.clientRequestId, "request-fixture-one");
  resolveCreation({ coalition: { coalitionId: "created-fixture" } });
  await creating;
  assert.deepEqual(h.navigations, ["/coalitions/created-fixture"]);
  assert.equal(h.data.size, 0);
});

test("create timeout freezes exact payload and requestID; status check never auto resubmits", async () => {
  let resolveLate;
  const h = fixture((path, _options, pending) =>
    path.includes("validate")
      ? pending()
      : new Promise((resolve) => {
          resolveLate = resolve;
        }),
  );
  h.capture();
  await h.page.load();
  const creating = h.page.submit(fields());
  await flush();
  const timeout = [...h.timers.values()][0];
  assert.equal(timeout.delay, 30000);
  timeout.fn();
  await creating;
  assert.equal(h.page.state().phase, "uncertain");
  assert.equal(h.page.state().canRetry, false);
  const original = h.calls[1].options.body;
  assert.equal(await h.page.submit(fields({ name: "Changed details" })), false);
  await h.page.action("organization-signup-check");
  assert.equal(h.page.state().canRetry, true);
  assert.equal(
    h.calls.filter((call) => call.path === "/api/coalitions").length,
    1,
  );
  const retry = h.page.action("organization-signup-retry");
  await flush();
  assert.deepEqual(h.calls.at(-1).options.body, original);
  resolveLate({ coalition: { coalitionId: "retried-fixture" } });
  await retry;
  assert.deepEqual(h.navigations, ["/coalitions/retried-fixture"]);
});

test("reopened uncertain invitation recovers a committed organization without another create", async () => {
  let resolveLate;
  const h = fixture((path, _options, pending) =>
    path.includes("validate")
      ? pending()
      : new Promise((resolve) => {
          resolveLate = resolve;
        }),
  );
  h.capture();
  await h.page.load();
  const creating = h.page.submit(fields());
  await flush();
  [...h.timers.values()][0].fn();
  await creating;
  const recovered = fixture(
    async () => ({
      ok: true,
      invitation: {
        status: "redeemed",
        recipientEmail: "ada@example.test",
        expiresAt: new Date(NOW - 1000).toISOString(),
        redeemedCoalitionId: "original-fixture",
      },
    }),
    { data: h.data },
  );
  recovered.page.captureLocation(
    "https://example.invalid/organizations/signup",
    () => {},
  );
  await recovered.page.load();
  assert.deepEqual(recovered.navigations, ["/coalitions/original-fixture"]);
  assert.equal(recovered.calls.length, 1);
  resolveLate({ coalition: { coalitionId: "late-should-not-open" } });
  await flush();
  assert.deepEqual(h.navigations, []);
});

test("reload after unknown create stays check-only if the immutable legal payload is gone", async () => {
  const h = fixture((path, _options, pending) =>
    path.includes("validate")
      ? pending()
      : Promise.reject(Error("network lost")),
  );
  h.capture();
  await h.page.load();
  await h.page.submit(fields());
  const reloaded = fixture(null, { data: h.data });
  reloaded.page.captureLocation(
    "https://example.invalid/organizations/signup",
    () => {},
  );
  await reloaded.page.load();
  assert.equal(reloaded.page.state().phase, "uncertain");
  assert.equal(reloaded.page.state().canRetry, false);
  await reloaded.page.action("organization-signup-retry");
  assert.equal(reloaded.calls.length, 1);
});

test("account and route changes fence late results and clear private form state", async () => {
  let resolve;
  const h = fixture((_path, _options, pending) =>
    resolve
      ? pending()
      : new Promise((done) => {
          resolve = done;
        }),
  );
  h.capture();
  const opening = h.page.load();
  await flush();
  h.context({ actorId: "actor-b", path: "/organizations/signup" });
  resolve(h.pending());
  await opening;
  assert.deepEqual(h.navigations, []);
  await h.page.load();
  assert.equal(JSON.parse([...h.data.values()][0]).actorId, "actor-b");
  h.context({ actorId: "actor-c", path: "/organizations/signup" });
  await h.page.load();
  assert.equal(h.data.size, 0);
  const other = fixture();
  other.capture();
  await other.page.load();
  other.context({ actorId: "actor-a", path: "/coalitions" });
  other.page.reset();
  assert.equal(await other.page.submit(fields()), false);
  assert.ok(other.draftsCleared() > 0);
});

test("validation deadline is20seconds and failed read does not create", async () => {
  const h = fixture(() => new Promise(() => {}));
  h.capture();
  const opening = h.page.load();
  await flush();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 20000);
  timer.fn();
  await opening;
  assert.equal(h.page.state().phase, "blocked");
  assert.equal(h.calls.length, 1);
});

test("form ownership and image-operation guards expire on invitation and actor changes", async () => {
  const h = fixture();
  h.capture();
  await h.page.load();
  const firstKey = h.page.state().formKey,
    firstGuard = h.page.operationGuard();
  assert.equal(h.page.ownsForm(firstKey), true);
  firstGuard();
  h.page.captureLocation(
    `https://example.invalid/organizations/signup?invitationToken=${"new-invitation-" + "z".repeat(40)}`,
    () => {},
  );
  assert.equal(h.page.ownsForm(firstKey), false);
  assert.throws(firstGuard);
  await h.page.load();
  assert.notEqual(h.page.state().formKey, firstKey);
  const secondGuard = h.page.operationGuard();
  h.context({ actorId: "different-actor", path: "/organizations/signup" });
  assert.equal(h.page.ownsForm(h.page.state().formKey), false);
  assert.throws(secondGuard);
  h.page.reset();
  assert.throws(() => h.page.operationGuard());
});

test("cancel and corrupt or expired storage remove signup secrets without a business call", async () => {
  const h = fixture();
  h.capture();
  await h.page.load();
  await h.page.action("organization-signup-cancel");
  assert.equal(h.data.size, 0);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.navigations, ["/coalitions"]);
  for (const value of [
    "broken JSON",
    JSON.stringify({
      invitationToken: TOKEN,
      clientRequestId: "fixture",
      savedAt: NOW - 8 * 24 * 60 * 60 * 1000,
    }),
  ]) {
    const data = new Map([["polis.organizationSignup.v1", value]]),
      invalid = fixture(null, { data });
    invalid.page.captureLocation(
      "https://example.invalid/organizations/signup",
      () => {},
    );
    await invalid.page.load();
    assert.equal(data.size, 0);
    assert.equal(invalid.calls.length, 0);
  }
  const aged = fixture();
  aged.capture();
  await aged.page.load();
  aged.advance(8 * 24 * 60 * 60 * 1000);
  assert.equal(await aged.page.submit(fields()), false);
  assert.equal(aged.data.size, 0);
  assert.equal(aged.calls.length, 1);
});

test("canonical/legacy route, auth hydration and public entrypoint source contracts remain wired", async () => {
  const source = await readFile(
    new URL(
      "../frontend/src/pages/shared-feed/shared-feed.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /ROUTE_KEY_COALITION_START, \/\^\\\/organizations\\\/signup\$\/u/,
  );
  assert.match(
    source,
    /ROUTE_KEY_COALITION_START, \/\^\\\/coalitions\\\/start\$\/u/,
  );
  assert.ok(
    source.indexOf("organizationSignup.captureLocation(window.location.href") <
      source.indexOf(
        "if (!(await requireAuthForRoute(route)))",
        source.indexOf("async function loadCurrentRoute"),
      ),
  );
  assert.doesNotMatch(
    source,
    /data-route="\/coalitions\/start"|label: "Start coalition"/,
  );
  const start = source.slice(
    source.indexOf("async function createCoalitionFromForm"),
    source.indexOf("async function requestJoinCoalitionFromForm"),
  );
  assert.match(start, /organizationSignup.submit\(formData\)/);
  assert.doesNotMatch(start, /fetchJson/);
  for (const file of ["server.js", "publicServer.js"]) {
    const server = await readFile(
      new URL(`../backend/src/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(server, /sendFrontendFile\(req, res, next, filePath\)/);
    assert.match(server, /organizations/);
  }
});
