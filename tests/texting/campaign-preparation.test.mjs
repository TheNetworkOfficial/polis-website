import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createCampaignPreparation } = await import(
  await moduleUrl("textingCampaignPreparation")
);

const campaign = (status = "preparing", extra = {}) => ({
  campaignId: "campaign-one",
  revision: 7,
  status: status === "complete" ? "prepared" : "draft",
  preparation: {
    preparationId: "approved-attempt-one",
    status,
    stage: "selected_contacts",
    canResume: false,
    automaticResume: false,
    pollAfterMs: 5000,
    selectedContactCount: 42,
    ...extra,
  },
});
function harness(responses, options = {}) {
  let clock = 0,
    nextId = 0,
    visible = true,
    current = true;
  const timers = new Map(),
    calls = [],
    errors = [],
    state = { campaign: campaign() };
  const runtime = {
    guard: () => {
      if (!current) throw new Error("Scope changed");
    },
    can: () => options.manage !== false,
    busy: () => false,
    changed: () => {},
    fail: (error) => errors.push(error),
    api: async (...args) => {
      calls.push(args);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return typeof response === "function"
        ? response(...args)
        : { campaign: structuredClone(response) };
    },
  };
  const controller = createCampaignPreparation(runtime, () => state, {
    now: () => clock,
    visible: () => visible,
    schedule: (fn, delay) => {
      const key = ++nextId;
      timers.set(key, { fn, delay });
      return key;
    },
    cancel: (key) => timers.delete(key),
    ...options,
  });
  return {
    controller,
    state,
    timers,
    calls,
    errors,
    hide: () => {
      visible = false;
    },
    scopeChanged: () => {
      current = false;
    },
    async tick() {
      const [key, timer] = timers.entries().next().value;
      timers.delete(key);
      clock += timer.delay;
      await timer.fn();
    },
  };
}

test("reload recovers saved preparation and finalizes only the same approved attempt", async () => {
  const ready = campaign("ready_to_finalize", {
    canResume: true,
    automaticResume: true,
    stage: "message",
  });
  const h = harness([campaign(), ready, campaign("complete")]);
  h.controller.observe(h.state.campaign);
  await h.tick();
  assert.equal(h.state.preparingRecipients, true);
  await h.tick();
  assert.equal(h.state.campaign.status, "prepared");
  assert.equal(h.state.preparingRecipients, false);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(
    h.calls.filter((call) => call[1]),
    [
      [
        "/campaigns/campaign-one/preparation/resume",
        {
          preparationId: "approved-attempt-one",
          expectedRevision: 7,
        },
      ],
    ],
  );
  h.controller.dispose();
});

test("campaign activation polls saved status until active without a preparation write", async () => {
  const opening = {
    ...campaign("preparing", {
      preparationId: "approved-activation-one",
      stage: "campaign_activation",
      selectedContactCount: null,
    }),
    status: "activating",
  };
  for (const preparation of [null, { status: "complete" }]) {
    const active = { ...opening, revision: 8, status: "active", preparation };
    const h = harness([opening, active]);
    h.controller.observe(opening);
    assert.equal(h.timers.values().next().value.delay, 5000);
    await h.tick();
    assert.equal(h.state.campaign.status, "activating");
    assert.equal(h.timers.size, 1);
    await h.tick();
    assert.equal(h.state.campaign.status, "active");
    assert.equal(h.state.preparingRecipients, false);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.calls, [
      ["/campaigns/campaign-one"],
      ["/campaigns/campaign-one"],
    ]);
    h.controller.dispose();
  }
});

test("activation cannot invoke recipient preparation resume even with stale resume flags", async () => {
  const opening = {
    ...campaign("ready_to_finalize", {
      stage: "campaign_activation",
      canResume: true,
      automaticResume: true,
    }),
    status: "activating",
  };
  const h = harness([opening, opening]);
  h.controller.observe(opening);
  await h.tick();
  await h.controller.refresh({ manual: true, resume: true });
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((call) => call[1] === undefined));
  h.controller.dispose();
});

test("ordinary entry and held dispatch do not start or resume provider transfer", async () => {
  const h = harness([]);
  h.controller.observe({ ...campaign(), preparation: null });
  assert.equal(h.timers.size, 0);
  h.controller.observe(
    campaign("needs_attention", {
      canResume: true,
      errorCode: "dispatch_failed",
    }),
  );
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.length, 0);
  h.controller.dispose();
});

test("manual recovery rereads current status then uses its preparation identity and revision", async () => {
  const held = campaign("needs_attention", { canResume: true });
  const h = harness([
    { ...held, revision: 9 },
    { ...campaign(), revision: 10 },
  ]);
  h.controller.observe(held);
  await h.controller.refresh({ manual: true, resume: true });
  assert.deepEqual(
    h.calls.map((call) => call[0]),
    ["/campaigns/campaign-one", "/campaigns/campaign-one/preparation/resume"],
  );
  assert.deepEqual(h.calls[1][1], {
    preparationId: "approved-attempt-one",
    expectedRevision: 9,
  });
  assert.equal(h.timers.size, 1);
  h.controller.dispose();
});

test("read errors and lost resume responses stop automatic writes until saved status is checked", async () => {
  const ready = campaign("ready_to_finalize", {
    canResume: true,
    automaticResume: true,
  });
  const h = harness([ready, new Error("response lost"), campaign("complete")]);
  h.controller.observe(ready);
  await h.tick();
  assert.equal(h.calls.filter((call) => call[1]).length, 1);
  assert.match(h.state.preparationRetryMessage, /Checking the saved result/);
  assert.equal(h.timers.size, 1);
  await h.tick();
  assert.equal(h.state.campaign.status, "prepared");
  assert.equal(h.calls.filter((call) => call[1]).length, 1);
  h.controller.dispose();
});

test("transient reads retry three times with backoff and never retry writes", async () => {
  const unavailable = () =>
    Object.assign(new Error("temporarily unavailable"), { status: 503 });
  const h = harness([
    unavailable(),
    unavailable(),
    unavailable(),
    unavailable(),
  ]);
  h.controller.observe(campaign());
  const delays = [];
  for (let step = 0; step < 4; step++) {
    delays.push(h.timers.values().next().value.delay);
    await h.tick();
  }
  assert.deepEqual(delays, [5000, 5000, 10000, 20000]);
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls.filter((call) => call[1]).length, 0);
  assert.equal(h.state.preparationPollingPaused, true);
  assert.equal(h.timers.size, 0);
  h.controller.dispose();
});

test("long running preparation backs off and meaningful stage progress resets only the delay", async () => {
  const h = harness(Array.from({ length: 30 }, () => campaign()));
  h.controller.observe(campaign());
  for (let step = 0; step < 12; step++) await h.tick();
  assert.equal(h.timers.values().next().value.delay, 15000);
  h.controller.observe(campaign("preparing", { stage: "provider_transfer" }));
  assert.equal(h.timers.values().next().value.delay, 5000);
  h.controller.dispose();
});

test("terminal campaigns never resume even if a stale DTO advertises it", async () => {
  for (const status of ["paused", "archived", "active"]) {
    const c = {
      ...campaign("ready_to_finalize", {
        canResume: true,
        automaticResume: true,
      }),
      status,
    };
    const h = harness([]);
    h.controller.observe(c);
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.length, 0);
    h.controller.dispose();
  }
});

test("automatic finalization attempts at most once per durable preparation", async () => {
  const ready = campaign("ready_to_finalize", {
    canResume: true,
    automaticResume: true,
  });
  const h = harness([ready, ready, ready]);
  h.controller.observe(ready);
  await h.tick();
  await h.tick();
  assert.equal(h.calls.filter((call) => call[1]).length, 1);
  h.controller.dispose();
});

test("checks are bounded and hidden, disposed or changed-scope views cannot keep polling", async () => {
  const h = harness([campaign(), campaign()], { maxReads: 2 });
  h.controller.observe(campaign());
  await h.tick();
  await h.tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.state.preparationPollingPaused, true);
  assert.equal(h.timers.size, 0);
  h.controller.dispose();
  const hidden = harness([]);
  hidden.hide();
  hidden.controller.observe(campaign());
  assert.equal(hidden.timers.size, 0);
  hidden.controller.dispose();
  const changed = harness([]);
  changed.controller.observe(campaign());
  changed.scopeChanged();
  await changed.tick();
  assert.equal(changed.calls.length, 0);
  changed.controller.dispose();
});

test("late status after disposal cannot publish data or auto-finalize", async () => {
  let release;
  const h = harness([
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  ]);
  h.controller.observe(campaign());
  const pending = h.tick();
  h.controller.dispose();
  release({
    campaign: campaign("ready_to_finalize", {
      canResume: true,
      automaticResume: true,
    }),
  });
  await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.campaign.preparation.status, "preparing");
});

test("revoked access stops polling and clears through the workspace denial handler", async () => {
  const error = Object.assign(new Error("forbidden"), { status: 403 });
  const h = harness([error]);
  h.controller.observe(campaign());
  await h.tick();
  assert.deepEqual(h.errors, [error]);
  assert.equal(h.timers.size, 0);
});

test("viewer and non-automatic statuses never trigger automatic finalization", async () => {
  for (const [status, manage, automaticResume] of [
    ["ready_to_finalize", false, true],
    ["preparing", true, true],
    ["ready_to_finalize", true, false],
  ]) {
    const c = campaign(status, { canResume: true, automaticResume });
    const h = harness([c], { manage });
    h.controller.observe(c);
    await h.tick();
    assert.equal(h.calls.filter((call) => call[1]).length, 0);
    h.controller.dispose();
  }
});

test("held preparation checks never reapprove or resume an uncertain transfer", async () => {
  const held = campaign("needs_attention", {
    errorCode: "prompt_provider_records_not_ready",
    canResume: false,
  });
  const h = harness([held, held]);
  h.controller.observe(held);
  assert.equal(h.timers.size, 0);
  await h.controller.refresh({ manual: true });
  await h.controller.refresh({ manual: true });
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((call) => call[1] === undefined));
  assert.equal(h.timers.size, 0);
  h.controller.dispose();
});

test("a delayed older status cannot replace a newer campaign or finalize its old preparation", async () => {
  let release;
  const h = harness([() => new Promise((resolve) => (release = resolve))]);
  h.controller.observe(campaign());
  const reading = h.tick();
  const newer = { ...campaign("complete"), revision: 8 };
  h.controller.observe(newer);
  release({
    campaign: campaign("ready_to_finalize", {
      canResume: true,
      automaticResume: true,
    }),
  });
  await reading;
  assert.equal(h.state.campaign, newer);
  assert.equal(h.state.preparingRecipients, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
  h.controller.dispose();
});

test("a lost resume followed by a nonresumable hold does not suggest another resume", async () => {
  const ready = campaign("ready_to_finalize", {
    canResume: true,
    automaticResume: true,
  });
  const held = campaign("needs_attention", { canResume: false });
  const h = harness([ready, new Error("lost response"), held]);
  h.controller.observe(ready);
  await h.tick();
  await h.tick();
  assert.match(h.state.preparationPollError, /needs review/);
  assert.doesNotMatch(h.state.preparationPollError, /resume/i);
  assert.equal(h.calls.filter((call) => call[1]).length, 1);
  assert.equal(h.timers.size, 0);
  h.controller.dispose();
});
