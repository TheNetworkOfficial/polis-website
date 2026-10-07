import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaignManagement } = await import(
  await moduleUrl("textingCampaignManagement")
);
const END = Date.parse("2099-12-01T18:31:42.123Z");
function fixture(t, options = {}) {
  const original = { window: globalThis.window, FormData: globalThis.FormData };
  globalThis.window = { confirm: () => true };
  globalThis.FormData = class {
    constructor(form) {
      this.values = form.values;
    }
    get(key) {
      return this.values[key];
    }
  };
  t.after(() => Object.assign(globalThis, original));
  const campaign = {
    campaignId: "campaign-one",
    revision: 4,
    status: "active",
    budgetMicros: 50000000,
    deliveryBeforeMs: END,
    canManageLimits: true,
    canManageBudget: true,
    canRecoverQueue: true,
    templateText: "Example Civic Team. Reply STOP.",
    audienceId: "frozen-audience",
    mediaId: "saved-image",
    ...options.campaign,
  };
  const state = { campaign },
    calls = [],
    holds = new Set(),
    toasts = [];
  let saved = { ...campaign },
    current = true;
  const allocation = {
    userId: "removed-volunteer",
    allocationId: "00000000-0000-4000-8000-000000000001",
    state: "held",
    items: [
      {
        itemId: "held-one",
        state: "held",
        canSkip: true,
        preview: {
          contactDisplayName: "Example Recipient",
          contactPhone: "+12025550124",
        },
      },
    ],
  };
  const r = {
    guard() {
      if (!current) throw new Error("Workspace changed");
    },
    busy: () => false,
    sendHeld: (key) => holds.has(key),
    holdSend: (key) => holds.add(key),
    releaseSend: (key) => holds.delete(key),
    toast: (text) => toasts.push(text),
    api: async (path, body, method) => {
      calls.push({ path, body, method });
      if (options.api)
        return options.api({
          path,
          body,
          method,
          state,
          allocation,
          saved,
          save: (value) => {
            saved = value;
          },
        });
      if (path.endsWith("/limits")) {
        saved = { ...saved, ...body, revision: saved.revision + 1 };
        delete saved.expectedRevision;
        return { campaign: saved };
      }
      if (path.includes("/queue-recovery?"))
        return {
          campaignId: campaign.campaignId,
          campaignRevision: saved.revision,
          allocations: [allocation],
        };
      if (path.endsWith("/skip"))
        return {
          result: {
            actionId: body.actionId,
            itemId: "held-one",
            state: "accepted",
            resendPermitted: false,
          },
        };
      return { campaign: saved };
    },
  };
  return {
    page: createCampaignManagement(r, () => state),
    state,
    calls,
    holds,
    allocation,
    toasts,
    leave: () => {
      current = false;
    },
  };
}
const form = (f, values = {}) => ({
  values: {
    campaignLimit: f.state.limitsDraft.budget,
    campaignLimitEnd: f.state.limitsDraft.end,
    ...values,
  },
});

test("active and paused limit edits send only changes with saved revision and retain exact untouched end", async (t) => {
  for (const status of ["active", "paused"]) {
    const f = fixture(t, { campaign: { status } });
    await f.page.action("campaign-limits-edit");
    await f.page.submit("campaign-limits", form(f, { campaignLimit: "75.00" }));
    assert.deepEqual(f.calls, [
      {
        path: "/campaigns/campaign-one/limits",
        method: "PATCH",
        body: { expectedRevision: 4, budgetMicros: 75000000 },
      },
    ]);
    assert.equal(f.state.campaign.deliveryBeforeMs, END);
    assert.equal(f.state.campaign.audienceId, "frozen-audience");
    assert.equal(
      f.state.campaign.templateText,
      "Example Civic Team. Reply STOP.",
    );
    assert.equal(f.state.campaign.mediaId, "saved-image");
    assert.equal(f.state.campaign.status, status);
  }
});

test("campaign manager without billing permission can extend end without sending a budget", async (t) => {
  const f = fixture(t, {
    campaign: { canManageBudget: false, budgetMicros: undefined },
  });
  await f.page.action("campaign-limits-edit");
  assert.doesNotMatch(f.page.render(), /name="campaignLimit"/);
  await f.page.submit(
    "campaign-limits",
    form(f, { campaignLimitEnd: "2099-12-02T18:31", campaignLimit: "999999" }),
  );
  assert.deepEqual(f.calls[0].body, {
    expectedRevision: 4,
    deliveryBeforeMs: new Date("2099-12-02T18:31").getTime(),
  });
});

test("end-only edits preserve unchanged sub-cent spending limits exactly", async (t) => {
  for (const budgetMicros of [5555000, 5556000]) {
    const f = fixture(t, { campaign: { budgetMicros } });
    await f.page.action("campaign-limits-edit");
    await f.page.submit(
      "campaign-limits",
      form(f, { campaignLimitEnd: "2099-12-02T18:31" }),
    );
    assert.deepEqual(f.calls[0].body, {
      expectedRevision: 4,
      deliveryBeforeMs: new Date("2099-12-02T18:31").getTime(),
    });
    assert.equal(f.state.campaign.budgetMicros, budgetMicros);
  }
});

test("limit reduction, fractional cents, shorter end and no change never call the API", async (t) => {
  const f = fixture(t);
  for (const values of [
    { campaignLimit: "49.99" },
    { campaignLimit: "50.001" },
    { campaignLimitEnd: "2099-11-01T10:00" },
    {},
  ]) {
    await f.page.action("campaign-limits-edit");
    await assert.rejects(f.page.submit("campaign-limits", form(f, values)));
  }
  assert.equal(f.calls.length, 0);
});

test("lost limit response preserves draft and requires explicit readback before another update", async (t) => {
  const f = fixture(t, {
    api: async ({ path, body, saved, save }) => {
      if (path.endsWith("/limits")) {
        save({ ...saved, budgetMicros: body.budgetMicros, revision: 5 });
        throw new Error("Response lost");
      }
      return { campaign: saved };
    },
  });
  await f.page.action("campaign-limits-edit");
  const request = form(f, { campaignLimit: "75.00" });
  await assert.rejects(
    f.page.submit("campaign-limits", request),
    /Response lost/,
  );
  assert.equal(f.state.limitsDraft.budget, "75.00");
  await assert.rejects(f.page.submit("campaign-limits", request), /Refresh/);
  assert.equal(f.calls.length, 1);
  await f.page.action("campaign-limits-refresh");
  assert.equal(f.state.campaign.budgetMicros, 75000000);
  assert.equal(f.state.limitsNeedsRead, false);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
});

test("absent capabilities and archived campaigns do not expose or permit limit edits", async (t) => {
  for (const campaign of [
    { canManageLimits: false, canRecoverQueue: false },
    { status: "archived", canManageLimits: true, canRecoverQueue: false },
  ]) {
    const f = fixture(t, { campaign });
    assert.equal(f.page.render(), "");
    await assert.rejects(f.page.action("campaign-limits-edit"));
    assert.equal(f.calls.length, 0);
  }
});

test("manager recovery binds an explicit skip to exact owner/allocation/revision then only rereads", async (t) => {
  const f = fixture(t);
  await f.page.action("campaign-recovery-refresh");
  await f.page.action("campaign-recovery-skip", "held-one");
  const writes = f.calls.filter((c) => c.body);
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].path,
    "/campaigns/campaign-one/queue-recovery/held-one/skip",
  );
  assert.deepEqual(Object.keys(writes[0].body).sort(), [
    "actionId",
    "allocationId",
    "expectedRevision",
    "userId",
  ]);
  assert.equal(writes[0].body.userId, "removed-volunteer");
  assert.equal(writes[0].body.allocationId, f.allocation.allocationId);
  assert.equal(writes[0].body.expectedRevision, 4);
  assert.match(writes[0].body.actionId, /^[a-f0-9-]{36}$/);
  assert.equal(
    f.calls.filter((c) => c.path.includes("queue-recovery?")).length,
    2,
  );
  await assert.rejects(f.page.action("campaign-recovery-skip", "held-one"));
  assert.match(f.page.render(), /Skipped/);
});

for (const outcome of ["lost", "unknown", "mismatched"])
  test(`manager skip ${outcome} never retries even after a stale eligible readback`, async (t) => {
    const f = fixture(t, {
      api: async ({ path, body, allocation }) => {
        if (path.includes("queue-recovery?"))
          return {
            campaignId: "campaign-one",
            campaignRevision: 4,
            allocations: [allocation],
          };
        if (outcome === "lost") throw new Error("Response lost");
        return {
          result: {
            actionId:
              outcome === "mismatched" ? "another-action" : body.actionId,
            itemId: "held-one",
            state: "provider_outcome_unknown",
            resendPermitted: false,
          },
        };
      },
    });
    await f.page.action("campaign-recovery-refresh");
    await f.page.action("campaign-recovery-skip", "held-one").catch(() => {});
    assert.equal(f.holds.size, 2);
    await f.page.action("campaign-recovery-refresh");
    await assert.rejects(f.page.action("campaign-recovery-skip", "held-one"));
    assert.equal(f.calls.filter((c) => c.body).length, 1);
    assert.match(f.page.render(), /Outcome needs review/);
  });

test("an unknown skip holds every sibling in the exact allocation after stale readback", async (t) => {
  const f = fixture(t, {
    api: async ({ path, body, allocation }) => {
      if (path.includes("queue-recovery?"))
        return {
          campaignId: "campaign-one",
          campaignRevision: 4,
          allocations: [
            {
              ...allocation,
              items: [
                allocation.items[0],
                { ...allocation.items[0], itemId: "held-two" },
              ],
            },
          ],
        };
      return {
        result: {
          actionId: body.actionId,
          itemId: "held-one",
          state: "provider_outcome_unknown",
          resendPermitted: false,
        },
      };
    },
  });
  await f.page.action("campaign-recovery-refresh");
  await f.page.action("campaign-recovery-skip", "held-one");
  await f.page.action("campaign-recovery-refresh");
  await assert.rejects(f.page.action("campaign-recovery-skip", "held-two"));
  assert.equal(f.calls.filter((c) => c.body).length, 1);
  assert.match(f.page.render(), /value="held-two" disabled/);
});

test("server non-skippable item and changed recovery pagination revision stay fenced", async (t) => {
  const f = fixture(t, {
    api: async ({ path, allocation }) => ({
      campaignId: "campaign-one",
      campaignRevision: path.includes("cursor=") ? 5 : 4,
      allocations: [
        { ...allocation, items: [{ ...allocation.items[0], canSkip: false }] },
      ],
      nextCursor: "next-page",
    }),
  });
  await f.page.action("campaign-recovery-refresh");
  await assert.rejects(f.page.action("campaign-recovery-skip", "held-one"));
  await assert.rejects(f.page.action("campaign-recovery-more"));
  assert.equal(f.state.recoveryNeedsRead, true);
  assert.equal(f.calls.filter((c) => c.body).length, 0);
});

test("late campaign write response cannot update a departed view", async (t) => {
  let f;
  f = fixture(t, {
    api: async ({ saved, body }) => {
      f.leave();
      return {
        campaign: { ...saved, budgetMicros: body.budgetMicros, revision: 5 },
      };
    },
  });
  await f.page.action("campaign-limits-edit");
  await assert.rejects(
    f.page.submit("campaign-limits", form(f, { campaignLimit: "75.00" })),
    /Workspace changed/,
  );
  assert.equal(f.state.campaign.budgetMicros, 50000000);
});
