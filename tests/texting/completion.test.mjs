import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { checkedTextingCompletion, createTextingCompletion } = await import(
  await moduleUrl("textingCompletion")
);

const counts = () => ({
  accepted: 37,
  delivered: 31,
  failed: 2,
  pending: 4,
  needsReview: 0,
  inbound: 9,
});
function proof(state = "campaign_complete") {
  return {
    version: 1,
    campaignId: "campaign",
    campaignRevision: 7,
    state,
    asOfMs: Date.now(),
    proofId: "proof-seven",
    campaign: {
      verified: true,
      audienceTotal: 50,
      worked: 50,
      remaining: 0,
      unresolved: 0,
    },
    personal: {
      actorUserId: "actor",
      allocationId: "allocation",
      batchComplete: true,
      counts: counts(),
      coverage: "complete",
    },
    results: {
      campaign: {
        counts: { ...counts(), accepted: 50, delivered: 44 },
        coverage: "complete",
        asOfMs: Date.now(),
      },
      team: null,
      series: [],
    },
    canArchive: state === "campaign_complete",
    blockedReasons: [],
  };
}
function fixture(t, { admin = false, response = proof(), api } = {}) {
  let actor = "actor",
    current = true;
  const state = {
      campaign: {
        campaignId: "campaign",
        name: "Neighborhood check-in",
        status: "active",
        canFetchQueue: true,
      },
      completionScope: "personal",
    },
    calls = [];
  const r = {
    context: () => ({ userId: actor, organizationId: "org", section: "send" }),
    guard: () => {
      if (!current || actor !== "actor") throw new Error("Workspace changed");
    },
    can: (key) => key === "manualQueue" || (admin && key === "createCampaigns"),
    busy: () => false,
    changed() {},
    navigate() {},
    api: async (path, body) => {
      calls.push({ path, body });
      if (api) return api(path, body, state);
      return { completion: response };
    },
  };
  const page = createTextingCompletion(r, () => state);
  t.after(() => page.dispose());
  return {
    page,
    state,
    calls,
    switchActor: () => {
      actor = "other";
    },
    leave: () => {
      current = false;
    },
  };
}

test("a changing-results read explains refresh without claiming partial history or allowing archive", async (t) => {
  let reads = 0;
  const f = fixture(t, {
    admin: true,
    api: async () => {
      if (++reads === 1)
        throw Object.assign(new Error("Changed"), {
          status: 409,
          payload: { error: "prompt_campaign_completion_changed" },
        });
      return { completion: proof() };
    },
  });
  await f.page.load();
  const failed = f.page.results();
  assert.match(failed, /Delivery results changed while this page was loading/);
  assert.doesNotMatch(
    failed,
    /\$\{|does not mean your sending history is missing/,
  );
  assert.doesNotMatch(failed, /Partial history|Recorded so far/);
  assert.match(
    failed,
    /data-workspace-action="completion-archive"[^>]*disabled/,
  );
  await f.page.action("completion-refresh");
  assert.equal(f.state.completionChanged, false);
  assert.match(f.page.results(), /pt-completion-sent/);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.body === undefined));
});

test("completion validates actor, campaign, proof and allocation independently of history coverage", () => {
  const p = proof();
  p.personal.counts = null;
  p.personal.coverage = "unavailable";
  p.results.campaign.counts = null;
  p.results.campaign.coverage = "partial";
  assert.equal(checkedTextingCompletion(p, "campaign", "actor"), p);
  for (const change of [
    (p) => (p.personal.actorUserId = "other"),
    (p) => (p.campaignId = "other"),
    (p) => (p.campaign.remaining = 1),
    (p) => (p.proofId = null),
    (p) => (p.personal.counts.accepted = null),
  ]) {
    const bad = proof();
    change(bad);
    assert.throws(() => checkedTextingCompletion(bad, "campaign", "actor"));
  }
  assert.throws(() =>
    checkedTextingCompletion(
      proof("batch_complete"),
      "campaign",
      "actor",
      "newer-allocation",
    ),
  );
});

test("empty personal queue and complete report coverage never create campaign completion", async (t) => {
  const f = fixture(t, { response: proof("waiting") });
  f.state.queue = { state: "complete", items: [] };
  await f.page.load({ finish: true });
  assert.match(f.page.finish(), /caught up for now/);
  assert.doesNotMatch(
    f.page.finish(),
    /Campaign texting finished|pt-completion--animate/,
  );
  assert.match(f.page.finish(), /Get next recipients/);
  assert.ok(f.calls.every((call) => call.body === undefined));
});

test("admin batch shows personal metrics and personal results, never team completion", async (t) => {
  const f = fixture(t, { admin: true, response: proof("batch_complete") });
  await f.page.load({ finish: true });
  const html = f.page.finish();
  assert.match(html, /finished your batch/);
  assert.match(html, />37<\/div>/);
  assert.doesNotMatch(html, /texts sent by the team|Campaign texting finished/);
  f.page.localAction("completion-results", "personal");
  assert.match(f.page.results(), /Your impact/);
});

test("unknown counts stay unknown and unsupported time series/team graphics are absent", async (t) => {
  const p = proof();
  p.personal.counts = null;
  p.personal.coverage = "unavailable";
  const f = fixture(t, { response: p });
  await f.page.load();
  assert.match(f.page.results(), /Results unavailable/);
  assert.doesNotMatch(
    f.page.results(),
    /pt-completion-activity|Volunteers who sent|0%/,
  );
});

test("refresh keeps good cards, coalesces reads and holds archive until verified", async (t) => {
  let resolve,
    reads = 0;
  const f = fixture(t, {
    admin: true,
    api: async () => {
      reads++;
      if (reads === 1) return { completion: proof() };
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  await f.page.load();
  const a = f.page.load(),
    b = f.page.load();
  assert.equal(reads, 2);
  assert.match(f.page.results(), />37<\/strong>/);
  assert.match(
    f.page.results(),
    /data-workspace-action="completion-archive"[^>]*disabled/,
  );
  assert.doesNotMatch(
    f.page.results(),
    /data-workspace-action="queue-leave"[^>]*disabled/,
  );
  resolve({ completion: proof() });
  await Promise.all([a, b]);
  assert.doesNotMatch(
    f.page.results(),
    /data-workspace-action="completion-archive"[^>]*disabled/,
  );
});

test("transient failure retains qualified results; authorization failure clears them", async (t) => {
  let error;
  const f = fixture(t, {
    admin: true,
    api: async () => {
      if (error) throw error;
      return { completion: proof() };
    },
  });
  await f.page.load();
  error = new Error("offline");
  await f.page.load();
  assert.match(f.page.results(), /Previous results/);
  assert.match(f.page.results(), />37<\/strong>/);
  assert.doesNotMatch(f.page.finish(), /Campaign texting finished/);
  error = Object.assign(new Error("denied"), { status: 403 });
  await assert.rejects(f.page.load(), /denied/);
  assert.equal(f.state.completion, null);
});

test("archive needs explicit confirmation, fresh matching proof and exact revision", async (t) => {
  let archived = false;
  const f = fixture(t, {
    admin: true,
    api: async (path, body) => {
      if (body) {
        archived = true;
        return {
          campaign: {
            campaignId: "campaign",
            name: "Neighborhood",
            status: "archived",
          },
        };
      }
      const p = proof(archived ? "archived" : "campaign_complete");
      return { completion: p };
    },
  });
  await f.page.load();
  f.page.localAction("completion-archive");
  assert.equal(f.calls.filter((call) => call.body).length, 0);
  await f.page.action("completion-confirm-archive");
  assert.deepEqual(
    f.calls.filter((call) => call.body),
    [
      {
        path: "/campaigns/campaign/transition",
        body: {
          expectedRevision: 7,
          action: "archive",
          completionProofId: "proof-seven",
        },
      },
    ],
  );
  assert.match(f.page.results(), /Sending and replies closed/);
});

test("archive is held for volunteer, unresolved, stale proof and local pending sends", async (t) => {
  for (const [admin, state, pending] of [
    [false, "campaign_complete", false],
    [true, "review_required", false],
    [true, "waiting", false],
    [true, "campaign_complete", true],
  ]) {
    const f = fixture(t, { admin, response: proof(state) });
    await f.page.load();
    if (pending) f.state.pendingItems = new Map([["one", "sending"]]);
    f.page.localAction("completion-archive");
    await f.page.action("completion-confirm-archive");
    assert.equal(f.calls.filter((call) => call.body).length, 0);
  }
  const f = fixture(t, { admin: true });
  await f.page.load();
  f.state.completion.asOfMs -= 180000;
  f.page.localAction("completion-archive");
  assert.ok(!f.state.completionDialog);
});

test("lost archive ACK remains held and refresh does not replay a business operation", async (t) => {
  const f = fixture(t, {
    admin: true,
    api: async (_path, body) => {
      if (body) throw Error("lost ACK");
      return { completion: proof() };
    },
  });
  await f.page.load();
  f.page.localAction("completion-archive");
  await f.page.action("completion-confirm-archive");
  assert.match(f.page.results(), /Closure needs checking/);
  await f.page.action("completion-refresh");
  f.page.localAction("completion-archive");
  await f.page.action("completion-confirm-archive");
  assert.equal(f.calls.filter((call) => call.body).length, 1);
});

test("late actor change cannot attach results or submit closure", async (t) => {
  let resolve;
  const f = fixture(t, {
    admin: true,
    api: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = f.page.load();
  f.switchActor();
  resolve({ completion: proof() });
  await assert.rejects(pending, /Workspace changed/);
  assert.equal(f.state.completion, undefined);
  assert.equal(f.calls.filter((call) => call.body).length, 0);
});

test("celebration plays once per proof across renders and controller recreation", async (t) => {
  const unique = proof();
  unique.proofId = "one-animation-only";
  const f = fixture(t, { response: unique });
  await f.page.load();
  assert.match(f.page.finish(), /pt-completion--animate/);
  assert.doesNotMatch(f.page.finish(), /pt-completion--animate/);
  const g = fixture(t, { response: unique });
  await g.page.load();
  assert.doesNotMatch(g.page.finish(), /pt-completion--animate/);
});

test("personal replies and hourly series are shown only with authoritative attribution", async (t) => {
  const p = proof();
  p.personal.inboundAvailable = false;
  p.results.team = { contributorCount: 3 };
  p.results.series = [
    { hourStartMs: Date.parse("2026-10-15T19:00:00Z"), campaignAccepted: 7 },
  ];
  const f = fixture(t, { response: p });
  await f.page.load();
  assert.doesNotMatch(f.page.finish(), /Incoming messages/);
  assert.doesNotMatch(f.page.results(), /pt-completion-replies|Your momentum/);
  f.page.localAction("completion-scope", "campaign");
  assert.match(
    f.page.results(),
    /Incoming messages|Team momentum|Volunteers who sent/,
  );
  assert.match(f.page.results(), /[AP]M/);
});

test("cancel during the fresh pre-archive read prevents the mutation", async (t) => {
  let resolve,
    reads = 0;
  const f = fixture(t, {
    admin: true,
    api: async () => {
      if (++reads === 1) return { completion: proof() };
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  await f.page.load();
  f.page.localAction("completion-archive");
  const pending = f.page.action("completion-confirm-archive");
  f.page.localAction("completion-cancel-archive");
  resolve({ completion: proof() });
  await pending;
  assert.equal(f.calls.filter((call) => call.body).length, 0);
});

test("authorization loss after archive response is propagated and clears private results", async (t) => {
  let archived = false;
  const f = fixture(t, {
    admin: true,
    api: async (_path, body) => {
      if (body) {
        archived = true;
        return { campaign: { campaignId: "campaign", status: "archived" } };
      }
      if (archived)
        throw Object.assign(Error("denied after closure"), { status: 403 });
      return { completion: proof() };
    },
  });
  await f.page.load();
  f.page.localAction("completion-archive");
  await assert.rejects(
    f.page.action("completion-confirm-archive"),
    /denied after closure/,
  );
  assert.equal(f.state.completion, null);
  assert.equal(f.calls.filter((call) => call.body).length, 1);
});
