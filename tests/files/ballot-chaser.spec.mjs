import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/ballotChaserModel.js",
    import.meta.url,
  ),
  "utf8",
);
const model = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("daily sent errors explain recovery while protecting the published voter list", () => {
  assert.match(
    model.ballotPreparationMessage("ballot_sent_updates_unavailable"),
    /Refresh Ballot Chaser/,
  );
  assert.match(
    model.ballotPreparationMessage("ballot_sent_source_limit"),
    /5 MB limit/,
  );
  assert.match(
    model.ballotPreparationMessage("ballot_sent_columns_invalid"),
    /ELECTDATE/,
  );
  assert.match(
    model.ballotPreparationMessage("ballot_sent_voter_review"),
    /published list is unchanged/,
  );
  assert.match(
    model.ballotPreparationMessage("ballot_preparation_history_review"),
    /do not start over or re-upload the master/,
  );
  assert.match(
    model.ballotPreparationMessage("ballot_snapshot_out_of_order"),
    /Do not invent a later date or time/,
  );
  assert.doesNotMatch(
    model.ballotPreparationMessage("ballot_preparation_cohort_limit"),
    /fixed voter cohort|trim|start over/i,
  );
});

test("source use remains unreviewed until an explicit permitted purpose is chosen", () => {
  assert.deepEqual(model.ballotSourceUsePolicy(), {
    permittedPurpose: "unreviewed",
    reviewRequired: true,
    requiresOptIn: false,
    smsProhibited: false,
  });
  assert.deepEqual(model.ballotSourceUsePolicy("manual_sms"), {
    permittedPurpose: "manual_sms",
    reviewRequired: false,
    requiresOptIn: false,
    smsProhibited: false,
  });
  assert.equal(
    model.ballotSourceUsePolicy("sms_with_opt_in").requiresOptIn,
    true,
  );
  assert.equal(model.ballotSourceUsePolicy("not_for_sms").smsProhibited, true);
  assert.throws(
    () => model.ballotSourceUsePolicy("approved"),
    /valid source-use policy/,
  );
});

test("ballot context requires a finished snapshot and fixes the election outstanding predicate", () => {
  assert.throws(
    () => model.ballotChaseContext("election", ""),
    /Finish a ballot update/,
  );
  assert.deepEqual(model.ballotChaseContext("az-general", "published"), {
    electionId: "az-general",
    snapshotId: "published",
    view: "outstanding",
    outstandingOnly: true,
  });
  assert.equal(model.ballotFileFormat("Pinal daily.XLSX"), "xlsx");
  assert.throws(
    () => model.ballotFileFormat("report.xlsm"),
    /CSV, TSV, or Excel/,
  );
});

test("preset appends once without mutating existing questions and enforces round capacity", () => {
  const original = [{ id: "existing", prompt: "Existing", choices: ["Yes"] }];
  const added = model.addBallotChasingPreset(original);
  assert.equal(added.length, 4);
  assert.equal(original.length, 1);
  assert.deepEqual(model.addBallotChasingPreset(added), added);
  assert.equal(added[1].id, "ballot_status");
  assert.throws(
    () =>
      model.addBallotChasingPreset(
        Array.from({ length: 38 }, (_, index) => ({ id: `existing_${index}` })),
      ),
    /at most 40/,
  );
});

test("conversation requires ballot report; literature never invents a respondent answer", () => {
  const questions = model.ballotChasingPreset.questions;
  assert.throws(() => model.validateQuestionAnswers(questions, {}), /Answer/);
  assert.deepEqual(
    model.validateQuestionAnswers(questions, {}, { conversation: false }),
    {},
  );
  assert.deepEqual(
    model.validateQuestionAnswers(questions, {
      ballot_status: "Already returned",
    }),
    { ballot_status: "Already returned" },
  );
  assert.throws(
    () =>
      model.validateQuestionAnswers(questions, {
        ballot_status: "Officially accepted",
      }),
    /Review/,
  );
  assert.throws(
    () =>
      model.validateQuestionAnswers(questions, {
        ballot_status: "Unsure",
        injected_question: "Yes",
      }),
    /round questions changed/,
  );
});

test("multi answers deduplicate valid values and reject changed choices", () => {
  const questions = [
    { id: "help", prompt: "Help", type: "multi", choices: ["Call", "Email"] },
  ];
  assert.deepEqual(
    model.validateQuestionAnswers(questions, { help: ["Call", "Call"] }),
    { help: ["Call"] },
  );
  assert.throws(
    () => model.validateQuestionAnswers(questions, { help: ["Other"] }),
    /Review/,
  );
});

test("signed spreadsheet upload omits account credentials and refuses redirects and unsafe destinations", async () => {
  const file = { name: "daily.xlsx" };
  let calls = 0;
  const upload = {
    url: "https://private-test.s3.us-west-2.amazonaws.com/report?signature=fictional",
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
  };
  await model.uploadBallotFile(file, upload, {
    guard: () => {},
    transport: async (url, options) => {
      calls++;
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.body, file);
      assert.equal(options.headers.authorization, undefined);
      assert.match(url, /private-test/);
      return { ok: true };
    },
  });
  assert.equal(calls, 1);
  for (const unsafe of [
    { ...upload, url: "http://private-test.s3.us-west-2.amazonaws.com/report" },
    { ...upload, url: "https://evil.example/report" },
    { ...upload, headers: { Authorization: "secret" } },
    { ...upload, method: "POST" },
  ])
    await assert.rejects(
      model.uploadBallotFile(file, unsafe, {
        guard: () => {},
        transport: async () => {
          throw new Error("must not dispatch");
        },
      }),
      /could not be verified/,
    );
});

test("account change before spreadsheet upload stops dispatch", async () => {
  let dispatched = false;
  await assert.rejects(
    model.uploadBallotFile(
      {},
      {},
      {
        guard: () => {
          throw new Error("Account changed");
        },
        transport: async () => {
          dispatched = true;
        },
      },
    ),
    /Account changed/,
  );
  assert.equal(dispatched, false);
});
