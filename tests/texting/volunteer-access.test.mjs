import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { prepareTextingAccess, saveAssignmentChanges } = await import(
  await moduleUrl("textingAccess")
);
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));

test("setup is bounded, checks the active route after waits, and never sends", async () => {
  const paths = [],
    delays = [],
    state = {};
  let current = true;
  const runtime = {
    guard: () => {
      if (!current) throw new Error("Workspace changed");
    },
    changed: () => {},
    api: async (path, body) => {
      paths.push(path);
      assert.deepEqual(body, { campaignId: "campaign" });
      return { texter: { state: "preparing", retryAfterMs: 90000 } };
    },
  };
  await assert.rejects(
    prepareTextingAccess(runtime, state, "campaign", async (delay) =>
      delays.push(delay),
    ),
    /still being prepared/,
  );
  assert.deepEqual(paths, [
    "/texter/ensure",
    "/texter/ensure",
    "/texter/ensure",
  ]);
  assert.deepEqual(delays, [30000, 30000]);
  assert.equal(state.preparingAccess, false);
  await assert.rejects(
    prepareTextingAccess(runtime, state, "campaign", async () => {
      current = false;
    }),
    /Workspace changed/,
  );
  assert.equal(paths.length, 4);
});

test("queue allocation waits for automatic setup and setup failure does not allocate", async () => {
  const campaign = { campaignId: "campaign", canFetchQueue: true },
    view = { campaigns: { campaign } },
    paths = [];
  let release;
  const runtime = {
    view: () => view,
    can: () => true,
    guard: () => {},
    changed: () => {},
    armExpiry: () => {},
    api: async (path) => {
      paths.push(path);
      if (path === "/texter/ensure")
        return new Promise((resolve) => {
          release = resolve;
        });
      return { items: [] };
    },
  };
  const page = createCampaigns(runtime);
  const pending = page.action("queue-load");
  assert.equal(view.campaigns.preparingAccess, true);
  assert.deepEqual(paths, ["/texter/ensure"]);
  release({ texter: { state: "ready" } });
  await pending;
  assert.deepEqual(paths, ["/texter/ensure", "/campaigns/campaign/queue"]);
  runtime.api = async (path) => {
    paths.push(path);
    throw new Error("Access revoked");
  };
  await assert.rejects(page.action("queue-load"), /Access revoked/);
  assert.equal(paths.filter((path) => path.endsWith("/queue")).length, 1);
});

test("hundreds of existing volunteers remain assigned while small revision fenced batches add and remove", async () => {
  let assigned = new Set(Array.from({ length: 400 }, (_, i) => `member-${i}`)),
    revision = 9;
  const campaign = {
      campaignId: "campaign",
      revision,
      assignedUserIds: [...assigned],
    },
    calls = [],
    saved = [];
  const selected = new Set([
    ...assigned,
    ...Array.from({ length: 120 }, (_, i) => `new-${i}`),
  ]);
  selected.delete("member-0");
  selected.delete("member-1");
  const result = await saveAssignmentChanges(
    async (path, body) => {
      assert.equal(path, "/campaigns/campaign/assignments");
      assert.equal(body.expectedRevision, revision);
      assert.equal("userIds" in body, false);
      assert.ok(body.addUserIds.length + body.removeUserIds.length <= 50);
      calls.push(body);
      assigned = new Set(
        [...assigned, ...body.addUserIds].filter(
          (userId) => !body.removeUserIds.includes(userId),
        ),
      );
      return {
        campaign: {
          ...campaign,
          revision: ++revision,
          assignedUserIds: [...assigned],
        },
      };
    },
    campaign,
    selected,
    (value) => saved.push(value.revision),
  );
  assert.deepEqual(new Set(result.assignedUserIds), selected);
  assert.deepEqual(saved, [10, 11, 12]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].removeUserIds, ["member-0", "member-1"]);
});

test("failed assignment write keeps removed rows and selections, then reconciles concurrent edits without resending them", async () => {
  const campaign = {
      campaignId: "campaign",
      name: "Example team",
      revision: 9,
      assignedUserIds: ["a", "b"],
    },
    view = { campaigns: { campaign, selected: new Set(["b", "c"]) } },
    calls = [];
  const page = createCampaigns({
    view: () => view,
    context: () => ({ resourceId: "campaign" }),
    can: () => true,
    busy: () => false,
    toast: () => {},
    api: async (path, body) => {
      calls.push({ path, body });
      if (body) throw new Error("Response lost");
      return {
        campaign: {
          ...campaign,
          revision: 11,
          assignedUserIds: ["a", "b", "d"],
        },
      };
    },
  });
  await assert.rejects(page.action("assignments-save"), /Response lost/);
  assert.equal(view.campaigns.assignmentsNeedRead, true);
  assert.deepEqual([...view.campaigns.selected], ["b", "c"]);
  assert.match(page.render("team"), /data-workspace-member="a"/);
  assert.match(page.render("team"), /Check saved assignments/);
  await page.action("assignments-save");
  assert.equal(calls.length, 1);
  await page.action("assignments-refresh");
  assert.deepEqual(view.campaigns.selected, new Set(["b", "c", "d"]));
  assert.equal(view.campaigns.campaign.revision, 11);
  assert.equal(view.campaigns.assignmentsNeedRead, false);
});
