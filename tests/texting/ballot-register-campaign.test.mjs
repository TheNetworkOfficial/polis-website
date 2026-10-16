import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const {
  createTextingBallotRecipients,
  ballotTextingSeed,
  readBallotTextingAccess,
} = await import(await moduleUrl("textingBallotRecipients"));
const { createCampaignDraftStore } = await import(
  await moduleUrl("textingCampaignDraft")
);
const ref = (value) => `voter_00_${value.repeat(64)}`;
const seed = {
  sourceType: "ballot_register",
  ballotChase: {
    electionId: "election-one",
    snapshotId: "snapshot-one",
    view: "outstanding",
  },
  query: {
    filter: { field: "precinct", op: "eq", value: "0007" },
    search: "Alex",
    sort: { field: "displayName", direction: "asc" },
  },
  selection: { mode: "all_matching", excludeVoterRefs: [ref("a")] },
};
const ready = (extra = {}) => ({
  selectionId: "register-selection",
  sourceType: "ballot_register",
  status: "ready",
  count: 500000,
  eligibleCount: 390000,
  consentReviewableCount: 0,
  recipientCount: 390000,
  excludedCount: 110000,
  heldCounts: { duplicate_phone: 12, opted_out: 9 },
  ballotChase: seed.ballotChase,
  manifestSha256: "a".repeat(64),
  samples: [
    {
      displayName: "Alex Example",
      maskedPhone: "••• 0123",
      eligibility: { status: "eligible" },
    },
  ],
  ...extra,
});
function harness(options = {}) {
  const calls = [],
    timers = [],
    view = { campaigns: { draft: { audienceId: "" } } };
  let actor = true,
    allowed = true,
    response = ready(),
    firstPost = true;
  const fields = options.fields ?? [
    { fieldId: "phone", label: "Phone", textingPhone: true },
  ];
  const controller = createTextingBallotRecipients(
    {
      guard() {
        if (!actor) throw new Error("Actor changed");
      },
      can: () => allowed,
      busy: () => false,
      changed() {},
      view: () => view,
      async contactApi(path, body) {
        calls.push({ path, body: structuredClone(body) });
        if (options.call) {
          const result = await options.call(path, body);
          if (result) return result;
        }
        if (path === "/schema")
          return {
            ok: true,
            capabilities: {
              read: true,
              select: true,
              export: true,
              personal: true,
              campaign: true,
              ...options.capabilities,
            },
          };
        if (path.endsWith("/voters"))
          return {
            ok: true,
            storageMode: "register",
            ballotChase: seed.ballotChase,
            schema: fields,
          };
        if (path.endsWith("/campaign"))
          return {
            ok: true,
            audienceId: "book_register-selection",
            exportAuthorized: false,
          };
        if (
          body &&
          path.endsWith("/texting-selections") &&
          options.loseAck &&
          firstPost
        ) {
          firstPost = false;
          throw new Error("Lost ACK");
        }
        return { ok: true, selection: structuredClone(response) };
      },
    },
    {
      schedule(fn) {
        timers.push(fn);
        return timers.length;
      },
      cancel() {},
    },
  );
  return {
    controller,
    calls,
    timers,
    view,
    switchActor: () => {
      actor = false;
    },
    allow: (value) => {
      allowed = value;
    },
    job: (value) => {
      response = value;
    },
  };
}

test("500k filtered handoff freezes opaque all-matching selection and reviews before bind without contacts/provider writes", async () => {
  const h = harness();
  await h.controller.load({ selection: seed });
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/texting-selections")).length,
    0,
  );
  await h.controller.action("ballot-recipients-review");
  const create = h.calls.find((call) =>
    call.path.endsWith("/texting-selections"),
  );
  assert.deepEqual(create.body.selection, {
    mode: "all_matching",
    includeVoterRefs: [],
    excludeVoterRefs: [ref("a")],
  });
  assert.deepEqual(create.body.filter, seed.query.filter);
  assert.deepEqual(create.body.sort, seed.query.sort);
  assert.equal(create.body.phoneFieldId, "phone");
  await assert.rejects(
    h.controller.bindCampaign("draft-one"),
    /Review and confirm/,
  );
  assert.match(h.controller.render(), /390,000/);
  assert.match(h.controller.render(), /Shared phone numbers/);
  assert.doesNotMatch(
    h.controller.render(),
    /voter_00_|register-selection|snapshot-one/,
  );
  h.controller.change({
    dataset: { workspaceBallotReviewed: "" },
    checked: true,
  });
  assert.equal(
    await h.controller.bindCampaign("draft-one"),
    "book_register-selection",
  );
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/campaign")).length,
    1,
  );
  assert.equal(
    h.calls.some((call) =>
      /\/contacts|\/export|\/transition|\/queue|\/send/.test(call.path),
    ),
    false,
  );
});

test("explicit selection keeps ref order and a lost create ACK requires exact explicit retry, including restoration", async () => {
  const h = harness({ loseAck: true });
  await h.controller.load({
    selection: {
      ...seed,
      selection: { mode: "explicit", includeVoterRefs: [ref("b"), ref("a")] },
    },
  });
  await h.controller.action("ballot-recipients-review");
  assert.match(h.controller.render(), /Check this request/);
  const snapshot = h.controller.snapshot();
  const recovered = harness();
  recovered.controller.restore(snapshot);
  await recovered.controller.load();
  assert.equal(
    recovered.calls.filter((call) => call.path.endsWith("/texting-selections"))
      .length,
    0,
  );
  await recovered.controller.action("ballot-recipients-review");
  assert.deepEqual(
    recovered.calls.find((call) => call.path.endsWith("/texting-selections"))
      .body,
    h.calls.find((call) => call.path.endsWith("/texting-selections")).body,
  );
  assert.deepEqual(snapshot.seed.selection.includeVoterRefs, [
    ref("b"),
    ref("a"),
  ]);
});

test("acknowledged building reviews poll GET only and do not preserve approval after manifest changes", async () => {
  const h = harness();
  h.job(ready({ status: "building", manifestSha256: undefined }));
  await h.controller.load({ selection: seed });
  await h.controller.action("ballot-recipients-review");
  h.job(ready());
  await h.controller.action("ballot-recipients-refresh");
  h.controller.change({
    dataset: { workspaceBallotReviewed: "" },
    checked: true,
  });
  h.job(ready({ manifestSha256: "b".repeat(64) }));
  await assert.rejects(
    h.controller.bindCampaign("draft-one"),
    /Review this recipient list/,
  );
  assert.equal(
    h.calls.filter(
      (call) => call.body && call.path.endsWith("/texting-selections"),
    ).length,
    1,
  );
  assert.equal(
    h.calls.some((call) => call.path.endsWith("/campaign")),
    false,
  );
});

test("only advertised phone columns can be chosen; an alternative requires explicit choice", async () => {
  const h = harness({
    fields: [
      { fieldId: "source_Mobile", label: "County mobile", textingPhone: true },
      { fieldId: "source_Notes", label: "Notes" },
    ],
  });
  await h.controller.load({ selection: seed });
  await assert.rejects(
    h.controller.action("ballot-recipients-review"),
    /Choose the phone column/,
  );
  const data = new FormData();
  data.set("phoneFieldId", "source_Notes");
  await assert.rejects(
    h.controller.submit("ballot-recipients-phone", data),
    /Choose the phone column/,
  );
  data.set("phoneFieldId", "source_Mobile");
  await h.controller.submit("ballot-recipients-phone", data);
  assert.equal(
    h.calls.find((call) => call.path.endsWith("/texting-selections")).body
      .phoneFieldId,
    "source_Mobile",
  );
});

for (const reason of ["wrong-view", "stale", "denied", "zero-eligible"])
  test(`authoritative ${reason} review cannot bind or retain a usable download/audience`, async () => {
    const h = harness({
      call: (path, body) => {
        if (!path.endsWith("/texting-selections") || !body) return;
        if (reason === "stale" || reason === "denied")
          throw Object.assign(
            new Error("Unavailable"),
            reason === "denied"
              ? { status: 403 }
              : { payload: { error: "ballot_snapshot_changed" } },
          );
        return {
          ok: true,
          selection:
            reason === "wrong-view"
              ? ready({
                  ballotChase: { ...seed.ballotChase, view: "returned" },
                })
              : ready({
                  status: "needs_review",
                  eligibleCount: 0,
                  excludedCount: 500000,
                }),
        };
      },
    });
    await h.controller.load({ selection: seed });
    await h.controller.action("ballot-recipients-review");
    h.controller.change({
      dataset: { workspaceBallotReviewed: "" },
      checked: true,
    });
    assert.equal(h.controller.reviewed(), false);
    await assert.rejects(h.controller.bindCampaign("draft-one"));
    assert.equal(h.view.campaigns.draft.audienceId, "");
    assert.equal(
      h.calls.some((call) => call.path.endsWith("/campaign")),
      false,
    );
  });

test("an actor switch while a review response is in flight cannot make its rows or approval usable", async () => {
  let release;
  const h = harness({
    call: (path, body) =>
      body && path.endsWith("/texting-selections")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined,
  });
  await h.controller.load({ selection: seed });
  const pending = h.controller.action("ballot-recipients-review");
  await new Promise(setImmediate);
  h.switchActor();
  release({ ok: true, selection: ready() });
  await assert.rejects(pending, /Actor changed/);
  assert.equal(h.controller.selection(), undefined);
});

test("scope and current Text Banking capability reads fail closed without provisioning", async () => {
  const calls = [];
  let actor = true;
  const guard = () => {
    if (!actor) throw new Error("Actor changed");
  };
  const request = async (path, options) => {
    options.beforeRequest();
    calls.push(path);
    return path.endsWith("/workspace")
      ? {
          ok: true,
          workspace: {
            scopeKey: "coalition:org",
            provider: "polis",
            manualOnly: true,
            status: "configured",
            capabilities: { createCampaigns: true, manageBilling: true },
          },
        }
      : { ok: true, billing: { canManageBilling: true } };
  };
  assert.equal(
    await readBallotTextingAccess({
      request,
      guard,
      scopeKey: "candidate:org",
    }),
    false,
  );
  assert.equal(
    await readBallotTextingAccess({
      request,
      guard,
      scopeKey: "coalition:org",
    }),
    true,
  );
  assert.equal(calls.length, 2);
  actor = false;
  await assert.rejects(
    readBallotTextingAccess({ request, guard, scopeKey: "coalition:org" }),
  );
  assert.equal(calls.length, 2);
});

test("register seed rejects other views, canonical IDs and oversized selection changes", () => {
  assert.throws(() =>
    ballotTextingSeed({
      ...seed,
      ballotChase: { ...seed.ballotChase, view: "returned" },
    }),
  );
  assert.throws(() =>
    ballotTextingSeed({
      ...seed,
      selection: { mode: "explicit", includeIds: ["contact"] },
    }),
  );
  assert.throws(() =>
    ballotTextingSeed({
      ...seed,
      selection: {
        mode: "all_matching",
        excludeVoterRefs: Array(5001).fill(ref("a")),
      },
    }),
  );
});

test("prospective recipients requiring sender consent stay distinct from eligible recipients and require manual review", async () => {
  const h = harness();
  h.job(
    ready({
      eligibleCount: 0,
      consentReviewableCount: 390000,
      recipientCount: 390000,
      heldCounts: {
        sender_consent_verification_required: 390000,
        opted_out: 110000,
      },
    }),
  );
  await h.controller.load({ selection: seed });
  await h.controller.action("ballot-recipients-review");
  assert.equal(h.controller.reviewed(), false);
  assert.match(h.controller.render(), /Eligible now/);
  assert.match(h.controller.render(), /Consent review/);
  assert.match(
    h.controller.render(),
    /Sender consent must be verified before preparation/,
  );
  h.controller.change({
    dataset: { workspaceBallotReviewed: "" },
    checked: true,
  });
  assert.equal(h.controller.reviewed(), true);
  assert.equal(
    await h.controller.bindCampaign("draft-one"),
    "book_register-selection",
  );
  assert.equal(h.controller.selection().eligibleCount, 0);
  assert.equal(
    h.calls.some((call) => /approve|transition|send|queue/.test(call.path)),
    false,
  );
});

test("inconsistent recipient, excluded or consent totals cannot be approved", async () => {
  for (const extra of [
    { recipientCount: 389999 },
    { consentReviewableCount: "0" },
    { excludedCount: 1 },
    { eligibleCount: 0, recipientCount: 0 },
  ]) {
    const h = harness();
    h.job(ready(extra));
    await h.controller.load({ selection: seed });
    await h.controller.action("ballot-recipients-review");
    h.controller.change({
      dataset: { workspaceBallotReviewed: "" },
      checked: true,
    });
    assert.equal(h.controller.reviewed(), false);
    await assert.rejects(h.controller.bindCampaign("draft-one"));
    assert.equal(
      h.calls.some((call) => call.path.endsWith("/campaign")),
      false,
    );
  }
});

test("an unknown audience bind retains the exact campaign operation across draft restoration", async () => {
  const first = harness({
    call: (path) => {
      if (path.endsWith("/campaign")) throw new Error("Lost bind ACK");
    },
  });
  await first.controller.load({ selection: seed });
  await first.controller.action("ballot-recipients-review");
  first.controller.change({
    dataset: { workspaceBallotReviewed: "" },
    checked: true,
  });
  await assert.rejects(
    first.controller.bindCampaign("draft-one"),
    /Lost bind ACK/,
  );
  const saved = JSON.parse(JSON.stringify(first.controller.snapshot()));
  const recovered = harness();
  recovered.controller.restore(saved);
  await recovered.controller.load();
  assert.equal(
    recovered.calls.some((call) => call.path.endsWith("/campaign")),
    false,
  );
  recovered.controller.change({
    dataset: { workspaceBallotReviewed: "" },
    checked: true,
  });
  await recovered.controller.bindCampaign("draft-one");
  assert.deepEqual(
    recovered.calls.find((call) => call.path.endsWith("/campaign")).body,
    first.calls.find((call) => call.path.endsWith("/campaign")).body,
  );
});

test("a 5000-reference unknown review fits a tab draft once, without retaining voter rows or phone values", async () => {
  const refs = Array.from(
    { length: 5000 },
    (_, i) => `voter_00_${i.toString(16).padStart(64, "0")}`,
  );
  const h = harness({ loseAck: true });
  await h.controller.load({
    selection: {
      ...seed,
      selection: { mode: "explicit", includeVoterRefs: refs },
    },
  });
  await h.controller.action("ballot-recipients-review");
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
  const store = createCampaignDraftStore(
    { userId: "actor", organizationId: "org" },
    { storage },
  );
  store.save(
    { campaignId: "draft-one", templateText: "A draft" },
    h.controller.snapshot(),
    "message",
  );
  const saved = store.read();
  assert.equal(saved.recipients.seed.selection.includeVoterRefs.length, 5000);
  assert.ok([...values.values()][0].length < 450000);
  assert.equal(saved.recipients.submission.selection, undefined);
  assert.equal(saved.recipients.samples, undefined);
  const recovered = harness();
  recovered.controller.restore(saved.recipients);
  await recovered.controller.load();
  await recovered.controller.action("ballot-recipients-review");
  assert.deepEqual(
    recovered.calls.find((call) => call.path.endsWith("/texting-selections"))
      .body,
    h.calls.find((call) => call.path.endsWith("/texting-selections")).body,
  );
});

test("each required fresh book capability independently blocks recipient review", async () => {
  for (const name of ["read", "select", "export", "personal", "campaign"]) {
    const h = harness({ capabilities: { [name]: false } });
    await h.controller.load({ selection: seed });
    await h.controller.action("ballot-recipients-review");
    assert.equal(
      h.calls.some((call) => call.path.endsWith("/texting-selections")),
      false,
    );
    assert.match(h.controller.render(), /Access changed/);
  }
});
