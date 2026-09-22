import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  process.env.POLIS_GOVERNANCE_SOURCE ||
    new URL(
      "../frontend/src/pages/shared-feed/shared-feed.js",
      import.meta.url,
    ),
  "utf8",
);

function setup({
  status = "DRAFT",
  freshStatus = "DRAFT",
  version = 7,
  permission = true,
  foreign = false,
  readError = false,
} = {}) {
  const vote = {
    voteId: "vote-1",
    organizationId: "org-1",
    status,
    voteVersion: 7,
    raw: { version: 7 },
  };
  const page = {
    selectedVote: vote,
    votes: [vote],
    overview: { viewer: { permissions: permission ? ["vote_manage"] : [] } },
    actionPendingKey: "",
    error: "",
  };
  const calls = [],
    messages = [];
  const body = {
    expectedVersion: 7,
    question: "Keep this draft?",
    rules: { ballotMethod: "YES_NO" },
  };
  const context = vm.createContext({
    currentOrganizationGovernanceId: () => "org-1",
    organizationGovernancePageState: () => page,
    organizationGovernanceFindVote: () => vote,
    organizationGovernanceVotePayloadFromForm: () => body,
    organizationGovernanceApiPath: (id, suffix) =>
      `/api/organizations/${id}/governance/v2/${suffix}`,
    organizationGovernanceRoutePath: (id, suffix) =>
      `/organizations/${id}/governance/${suffix}`,
    normalizeOrganizationGovernanceVote: (value) => ({
      ...value.vote,
      voteVersion: value.vote.version,
      raw: value.vote,
    }),
    showToast: (message) => messages.push(message),
    scheduleRender: () => {},
    navigateTo: () => {},
    loadOrganizationGovernancePage: async () => {},
    settingsErrorMessage: (error) => error.message,
    fetchJson: async (path, options) => {
      calls.push({ path, method: options.method || "GET", body: options.body });
      if (options.method === "PATCH") return { ok: true };
      if (readError) throw new Error("Synthetic read failure");
      return {
        vote: {
          ...vote,
          organizationId: foreign ? "other" : "org-1",
          status: freshStatus,
          version,
        },
      };
    },
  });
  for (const name of [
    "normalizeString",
    "parseBoolean",
    "readObjectPayload",
    "readArrayPayload",
    "readOptionalGovernanceNumber",
    "organizationGovernanceViewerPermissionSet",
    "organizationGovernanceViewerCan",
    "organizationGovernanceVoteCanEdit",
  ]) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) continue; // Enables the exact preserved source's failing-before run.
    const end = source.indexOf("\nfunction ", start + 1);
    assert.ok(end > start);
    vm.runInContext(source.slice(start, end), context);
  }
  const start = source.indexOf(
    "async function updateOrganizationGovernanceVote(",
  );
  const end = source.indexOf(
    "\nasync function createOrganizationGovernanceAuditCase",
    start,
  );
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return {
    calls,
    messages,
    page,
    body,
    save: () =>
      context.updateOrganizationGovernanceVote(new Map([["voteId", "vote-1"]])),
  };
}

for (const status of [
  "SEALED",
  "OPEN",
  "CLOSED",
  "TALLYING",
  "CERTIFIED",
  "PUBLISHED",
  "CANCELLED",
]) {
  test(`${status} cannot initiate a draft update`, async () => {
    const fixture = setup({ status });
    assert.equal(await fixture.save(), false);
    assert.equal(fixture.calls.length, 0);
  });
}
test("draft without management permission cannot update", async () => {
  const fixture = setup({ permission: false });
  assert.equal(await fixture.save(), false);
  assert.equal(fixture.calls.length, 0);
});
for (const options of [
  { freshStatus: "PUBLISHED" },
  { freshStatus: "CERTIFIED" },
  { version: 8 },
  { foreign: true },
  { readError: true },
]) {
  test(`fresh read fences stale draft save ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options);
    assert.equal(await fixture.save(), false);
    assert.deepEqual(
      fixture.calls.map((x) => x.method),
      ["GET"],
    );
    assert.equal(fixture.page.actionPendingKey, "");
  });
}
test("unchanged managed draft saves exact existing body after fresh GET", async () => {
  const fixture = setup();
  assert.equal(await fixture.save(), true);
  assert.deepEqual(
    fixture.calls.map((x) => x.method),
    ["GET", "PATCH"],
  );
  assert.equal(fixture.calls[1].body, fixture.body);
  assert.equal(fixture.page.actionPendingKey, "");
});
