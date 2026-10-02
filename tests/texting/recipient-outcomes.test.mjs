import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createRecipientOutcomes } = await import(
  await moduleUrl("textingRecipientOutcomes")
);
const target = { campaignId: "campaign", itemId: "item" };
const dto = (extra = {}) => ({
  outcome: {
    contactRevision: 2,
    tags: [],
    availableTags: [{ tagId: "supporter", label: "Supporter" }],
    selfReportedParty: null,
    partyOptions: ["Democratic", "Republican", "Unknown"],
    nextTagCursor: null,
    capabilities: { record: true, tag: true, party: true, manageTags: false },
    savedOperationId: null,
    savedRevision: null,
    ...extra,
  },
});
function harness(api) {
  let allowed = true,
    current = true;
  const calls = [],
    messages = [];
  const runtime = {
    guard: () => {
      if (!current) throw new Error("Scope changed");
    },
    can: () => allowed,
    busy: () => false,
    toast: (value) => messages.push(value),
    api: async (...args) => {
      calls.push(args);
      return api ? api(...args) : dto();
    },
  };
  const helper = createRecipientOutcomes(runtime, "test-outcome");
  return {
    helper,
    calls,
    messages,
    revoke: () => {
      allowed = false;
    },
    changeScope: () => {
      current = false;
    },
    open: () => helper.action("test-outcome-open", JSON.stringify(target)),
    party: (value) =>
      helper.change({
        dataset: { outcomeChange: "test-outcome" },
        name: "outcomeParty",
        value,
      }),
    tag: (tagId, checked) =>
      helper.change({
        dataset: { outcomeChange: "test-outcome", tagId },
        checked,
      }),
  };
}
test("outcome entry is permission gated and opening only reads the assigned target", async () => {
  const f = harness();
  assert.match(f.helper.trigger(target), /Record outcome/);
  await f.open();
  assert.deepEqual(f.calls, [["/campaigns/campaign/queue/item/outcome"]]);
  assert.match(f.helper.render(), /type="checkbox"/);
  f.revoke();
  assert.equal(f.helper.trigger(target), "");
  assert.equal(f.helper.render(), "");
  await assert.rejects(f.open(), /permission/);
});
test("save sends only changed approved tags and party with optimistic revision", async () => {
  const f = harness((_path, body) =>
    body
      ? dto({
          contactRevision: 3,
          tags: [{ tagId: "supporter", label: "Supporter" }],
          selfReportedParty: "Democratic",
          savedOperationId: body.operationId,
          savedRevision: 3,
        })
      : dto(),
  );
  await f.open();
  f.tag("supporter", true);
  f.party("Democratic");
  await f.helper.submit("test-outcome-save");
  const body = f.calls[1][1];
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "operationId",
      "expectedRevision",
      "addTagIds",
      "removeTagIds",
      "selfReportedParty",
    ].sort(),
  );
  assert.equal(body.expectedRevision, 2);
  assert.deepEqual(body.addTagIds, ["supporter"]);
  assert.deepEqual(body.removeTagIds, []);
  assert.equal(body.selfReportedParty, "Democratic");
  assert.match(f.helper.render(), /Outcome saved/);
  await f.helper.submit("test-outcome-save");
  assert.equal(f.calls.length, 2);
});
test("uncertain save checks a receipt read-only and retries exactly the same operation", async () => {
  let writes = 0;
  const f = harness((_path, body) => {
    if (body && ++writes === 1) throw new Error("Network timeout");
    return dto(
      body ? { savedOperationId: body.operationId, savedRevision: 3 } : {},
    );
  });
  await f.open();
  f.party("Republican");
  await assert.rejects(f.helper.submit("test-outcome-save"), /timeout/);
  const original = structuredClone(f.calls[1][1]);
  await assert.rejects(f.helper.submit("test-outcome-save"), /existing save/);
  await f.helper.action("test-outcome-check");
  assert.match(f.calls[2][0], /\?operationId=/);
  assert.equal(f.calls[2][1], undefined);
  await f.helper.action("test-outcome-retry");
  assert.deepEqual(f.calls[3][1], original);
});
test("a lost response already committed resolves from GET without a second mutation", async () => {
  let operationId;
  const f = harness((path, body) => {
    if (body) {
      operationId = body.operationId;
      throw new Error("Response lost");
    }
    return dto(
      path.includes("?operationId=")
        ? { savedOperationId: operationId, savedRevision: 3 }
        : {},
    );
  });
  await f.open();
  f.party("Unknown");
  await assert.rejects(f.helper.submit("test-outcome-save"));
  await f.helper.action("test-outcome-check");
  assert.equal(f.calls.filter((call) => call[1]).length, 1);
  assert.doesNotMatch(f.helper.render(), /Retry this save/);
});
test("pagination preserves an unchanged draft but resets on a changed revision", async () => {
  let version = 2;
  const f = harness((path) =>
    dto({
      contactRevision: version,
      nextTagCursor: path.includes("tagCursor") ? null : "next",
      availableTags: path.includes("tagCursor")
        ? [{ tagId: "donor", label: "Donor" }]
        : [{ tagId: "supporter", label: "Supporter" }],
    }),
  );
  await f.open();
  f.tag("supporter", true);
  await f.helper.action("test-outcome-more");
  assert.match(f.helper.render(), /data-tag-id="supporter" checked/);
  await f.open();
  f.tag("supporter", true);
  version = 3;
  await f.helper.action("test-outcome-more");
  assert.doesNotMatch(f.helper.render(), /data-tag-id="supporter" checked/);
  assert.ok(f.messages.some((value) => value.includes("contact changed")));
});
test("scope or permission loss after a read prevents stale render and mutations", async () => {
  let finish;
  const f = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const opening = f.open();
  f.changeScope();
  finish(dto());
  await assert.rejects(opening, /Scope changed/);
  f.helper.dispose();
  assert.equal(f.helper.render(), "");
  assert.equal(f.calls.length, 1);
});
test("tag and party labels are escaped and no-tags manager guidance is actionable", async () => {
  const f = harness(() =>
    dto({
      availableTags: [{ tagId: "x", label: '<img src=x onerror="bad()">' }],
      selfReportedParty: "Unlisted uploaded value",
    }),
  );
  await f.open();
  assert.doesNotMatch(f.helper.render(), /<img/);
  assert.match(f.helper.render(), /&lt;img/);
  assert.match(f.helper.render(), /Unlisted uploaded value/);
  const manager = harness(() =>
    dto({
      availableTags: [],
      capabilities: { record: true, manageTags: true },
    }),
  );
  await manager.open();
  assert.match(manager.helper.render(), /Fields and tags/);
});
