import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceRoot = new URL(
  "../frontend/src/pages/shared-feed/",
  import.meta.url,
);
const authSource = await readFile(
  new URL("scripts/sharedFeedAuth.js", sourceRoot),
  "utf8",
);
const { buildAuthorizedHeaders } = await import(
  `data:text/javascript;base64,${Buffer.from(authSource).toString("base64")}`
);
const pageSource = await readFile(
  new URL("shared-feed.js", sourceRoot),
  "utf8",
);
const start = pageSource.indexOf("async function fetchJson(");
const end = pageSource.indexOf("\nfunction updateItem(", start);
assert.ok(start >= 0 && end > start, "actual production transport is present");

// Execute the unchanged production transport with the real auth module. Only
// browser state and the final network boundary are replaced by test fixtures.
function transport(
  session = { idToken: "fixture-id", accessToken: "fixture-access" },
) {
  const requests = [];
  const context = vm.createContext({
    state: { auth: { session } },
    window: {},
    getApiBaseUrl: () => "https://api.polis.test",
    buildAuthorizedHeaders,
    normalizeString: (value) => String(value || "").trim(),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });
  vm.runInContext(pageSource.slice(start, end), context);
  return { requests, fetchJson: context.fetchJson };
}

for (const path of [
  "/api/organizations/org-1/governance/v2",
  "/api/organizations/org-1/governance/v2?limit=10",
  "/api/organizations/org-1/governance/v2/votes/vote-1",
  "/api/organizations/org%20one/governance/v2/votes/vote-1/results?cursor=next",
]) {
  test(`Governance GET uses the access bearer: ${path}`, async () => {
    const { fetchJson, requests } = transport();
    await fetchJson(path, { auth: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Authorization, "Bearer fixture-access");
    assert.equal(requests[0].headers["X-Cognito-Access-Token"], undefined);
  });
}

test("Governance mutation keeps its payload and idempotency headers with access bearer", async () => {
  const { fetchJson, requests } = transport();
  const body = { expectedVersion: 5 };
  await fetchJson(
    "/api/organizations/org-1/governance/v2/audit-cases/case-1/disclose",
    {
      auth: true,
      method: "POST",
      body,
      headers: { "Idempotency-Key": "fixed-attempt" },
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.Authorization, "Bearer fixture-access");
  assert.equal(requests[0].headers["Idempotency-Key"], "fixed-attempt");
  assert.equal(requests[0].body, JSON.stringify(body));
});

for (const path of [
  "/api/coalitions/org-1",
  "/api/coalitions/org-1/members",
  "/api/profile/me",
  "/api/organizations/org-1/governance/v20",
  "/api/public/governance/v2/organizations/org-1",
  "/api/organizations/org-1/profile?next=/governance/v2",
]) {
  test(`Existing unscoped transport keeps its ID bearer: ${path}`, async () => {
    const { fetchJson, requests } = transport();
    await fetchJson(path, { auth: true });
    assert.equal(requests[0].headers.Authorization, "Bearer fixture-id");
  });
}

test("missing Governance access token fails clearly before sending an ID token", async () => {
  const { fetchJson, requests } = transport({ idToken: "fixture-id" });
  await assert.rejects(
    fetchJson("/api/organizations/org-1/governance/v2/votes/vote-1", {
      auth: true,
    }),
    (error) =>
      error.statusCode === 401 &&
      error.errorCode === "unauthorized" &&
      error.message === "Governance requires sign-in.",
  );
  assert.equal(requests.length, 0);
});

test("anonymous requests remain unauthenticated even with a signed-in session", async () => {
  const { fetchJson, requests } = transport();
  await fetchJson("/api/public/governance/v2/organizations/org-1", {
    auth: false,
  });
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(requests[0].headers["X-Cognito-Access-Token"], undefined);
});

test("existing opt-in access companion header does not change legacy bearer", async () => {
  const { fetchJson, requests } = transport();
  await fetchJson("/api/profile/me", { auth: true, includeAccessToken: true });
  assert.equal(requests[0].headers.Authorization, "Bearer fixture-id");
  assert.equal(requests[0].headers["X-Cognito-Access-Token"], "fixture-access");
});
