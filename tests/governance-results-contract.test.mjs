import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../frontend/src/pages/shared-feed/shared-feed.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({});
for (const name of [
  "normalizeString",
  "parseBoolean",
  "readObjectPayload",
  "readOptionalGovernanceNumber",
  "normalizeGovernanceStringListPayload",
  "normalizeGovernanceIntegerString",
  "normalizeGovernanceExactRational",
  "normalizeGovernanceStvRound",
  "normalizeCoalitionVoteResults",
  "normalizeOrganizationGovernanceResults",
]) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start, `${name} production source found`);
  vm.runInContext(source.slice(start, end), context);
}
const normalize = (payload) =>
  context.normalizeOrganizationGovernanceResults(payload);

// Actual V2 producer shape: governancePhysicalTallyAccumulator.finalize and
// governancePhysicalCertifiedResultView preserve counts and nested turnout.
// Confidential additive YES_NO uses this same final result contract.
function certified(method = "YES_NO", privacyMode = "OPEN_ATTRIBUTED") {
  return {
    ok: true,
    voteId: "synthetic-vote",
    result: {
      schemaVersion: "governance_physical_certified_result_payload_v1",
      ballotMethod: method,
      privacyMode,
      passed: true,
      quorumMet: true,
      denominator: 8,
      supportCount: 6,
      counts: { YES: 6, NO: 2, ABSTAIN: 1 },
      turnout: {
        eligibleAtSeal: 12,
        acknowledgedPresent: 10,
        ballotsCast: 9,
        validNonAbstaining: 8,
        abstentions: 1,
        invalid: 0,
      },
      signatureStatus: "SIGNED",
      manifestHash: "synthetic-manifest",
    },
  };
}

for (const method of [
  "YES_NO",
  "UNANIMOUS_CONSENT",
  "OBSERVED_DIVISION",
  "AGGREGATE_FLOOR_COUNT",
]) {
  test(`certified ${method} preserves producer counts and turnout`, () => {
    const result = normalize(certified(method));
    assert.deepEqual(JSON.parse(JSON.stringify(result.tallies)), {
      yes: 6,
      no: 2,
      abstain: 1,
    });
    assert.equal(result.ballotsCast, 9);
    assert.equal(result.outcome, "passed");
    assert.equal(result.quorumMet, true);
  });
}

test("sealed-audit additive results use the same count contract", () => {
  const result = normalize(certified("YES_NO", "SEALED_AUDIT"));
  assert.equal(result.tallies.yes, 6);
  assert.equal(result.ballotsCast, 9);
  assert.equal(result.privacyMode, "SEALED_AUDIT");
});

test("certified false outcome is not displayed as pending", () => {
  const value = certified();
  value.result.passed = false;
  assert.equal(normalize(value).outcome, "failed");
});

for (const method of [
  "STV",
  "IRV",
  "PLURALITY",
  "APPROVAL",
  "SCORE",
  "CUMULATIVE",
]) {
  test(`${method} uses nested turnout without manufacturing YES_NO tallies`, () => {
    const value = certified(method);
    value.result.counts = { alpha: 6, beta: 2 };
    value.result.totals = { alpha: 16, beta: 8 };
    const result = normalize(value);
    assert.equal(result.ballotsCast, 9);
    assert.equal(result.tallies, null);
  });
}

test("explicit legacy count fields, including zero, retain precedence", () => {
  const value = certified();
  value.result.ballotsCast = 0;
  value.result.tallies = { yes: 0, no: 0, abstain: 0 };
  value.result.outcome = "legacy status";
  const result = normalize(value);
  assert.equal(result.ballotsCast, 0);
  assert.equal(result.tallies.yes, 0);
  assert.equal(result.outcome, "legacy status");
});

test("absent counts do not manufacture empty result bars", () => {
  const value = certified();
  delete value.result.counts;
  assert.equal(normalize(value).tallies, null);
});

test("incomplete ranked count stays unresolved even when passed is false", () => {
  const value = certified("STV");
  value.result.countStatus = "INCOMPLETE_TIE_REQUIRES_NEW_ELECTION";
  value.result.passed = false;
  assert.equal(normalize(value).outcome, "count unresolved");
  value.result.countStatus = "COMPLETE";
  assert.equal(normalize(value).outcome, "complete");
});

test("legacy coalition normalizer retains its original result contract", () => {
  const result = context.normalizeCoalitionVoteResults({
    ballotsCast: 4,
    tallies: { YES: 3, NO: 1, ABSTAIN: 0 },
    outcome: "approved",
  });
  assert.equal(result.ballotsCast, 4);
  assert.equal(result.tallies.yes, 3);
  assert.equal(result.passed, true);
});
