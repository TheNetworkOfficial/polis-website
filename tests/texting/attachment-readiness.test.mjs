import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
function fixture(t, options = {}) {
  const previous = globalThis.window;
  globalThis.window = { confirm: () => true };
  t.after(() => {
    globalThis.window = previous;
  });
  const campaign = {
    campaignId: "campaign-one",
    revision: 4,
    status: "prepared",
    name: "Example campaign",
    mediaId: "image-one",
    mediaReady: false,
    templateText: "Example Civic Team. Reply STOP to opt out.",
    canActivate: true,
    assignedUserIds: [],
    blockedReasons: [],
  };
  const view = {
    campaigns: {
      campaign,
      draft: { ...campaign },
      scheduleUnsupported: true,
      media: {
        mediaId: "image-one",
        state: "local_ready",
        providerReady: false,
      },
    },
  };
  const calls = [];
  let ready = false,
    failSync = options.failSync,
    failRead = options.failRead;
  const r = {
    context: () => ({
      userId: "manager",
      organizationId: "example",
      resourceId: "campaign-one",
      section: "campaigns",
    }),
    view: () => view,
    can: (key) => ["createCampaigns", "canPrepareProviderMedia"].includes(key),
    contactApi: { invalidate() {} },
    busy: () => false,
    guard() {},
    changed() {},
    api: async (path, body) => {
      calls.push({ path, body });
      if (path.endsWith("/provider-sync")) {
        ready = true;
        if (failSync) {
          failSync = false;
          throw new Error("Response lost");
        }
        return {
          media: {
            mediaId: "image-one",
            state: "provider_verified",
            providerReady: true,
          },
        };
      }
      if (path.endsWith("/content"))
        return {
          media: {
            mediaId: "image-one",
            state: "provider_verified",
            providerReady: true,
          },
        };
      assert.equal(path, "/campaigns/campaign-one");
      if (failRead) {
        failRead = false;
        throw new Error("Read unavailable");
      }
      return { campaign: { ...campaign, mediaReady: ready } };
    },
  };
  const page = createCampaigns(r);
  t.after(() => page.dispose());
  return { page, view, calls, r };
}

test("prepared campaign exposes attachment preparation and refreshes frozen readiness without recipient preparation", async (t) => {
  const f = fixture(t);
  assert.match(f.page.render("campaigns"), /Attachment needs preparation/);
  assert.match(
    f.page.render("campaigns"),
    /data-workspace-action="media-prepare"/,
  );
  assert.doesNotMatch(
    f.page.render("campaigns"),
    /data-workspace-action="transition-activate"/,
  );
  await assert.rejects(
    f.page.action("transition-activate"),
    /attachment readiness/,
  );
  await f.page.action("media-prepare");
  assert.deepEqual(f.calls, [
    { path: "/media/image-one/provider-sync", body: {} },
    { path: "/campaigns/campaign-one", body: undefined },
  ]);
  assert.equal(f.view.campaigns.campaign.revision, 4);
  assert.match(f.page.render("campaigns"), /Attachment ready/);
  assert.match(
    f.page.render("campaigns"),
    /data-workspace-action="transition-activate"/,
  );
});

test("verified asset can explicitly repair missing frozen campaign linkage", async (t) => {
  const f = fixture(t);
  f.view.campaigns.media = { state: "provider_verified", providerReady: true };
  assert.match(f.page.render("campaigns"), /Attachment needs preparation/);
  await f.page.action("media-prepare");
  assert.equal(f.view.campaigns.campaign.mediaReady, true);
  assert.equal(f.calls.filter((c) => c.body).length, 1);
});

for (const failure of ["failSync", "failRead"]) {
  test(`${failure}: attachment uncertainty requires readback and never repeats upload`, async (t) => {
    const f = fixture(t, { [failure]: true });
    await assert.rejects(f.page.action("media-prepare"));
    assert.equal(f.view.campaigns.mediaNeedsRead, true);
    assert.match(f.page.render("campaigns"), /Refresh attachment/);
    assert.doesNotMatch(
      f.page.render("campaigns"),
      /data-workspace-action="transition-activate"/,
    );
    await assert.rejects(f.page.action("media-prepare"), /Refresh attachment/);
    await f.page.action("media-refresh");
    assert.equal(f.view.campaigns.mediaNeedsRead, false);
    assert.equal(f.view.campaigns.campaign.mediaReady, true);
    assert.equal(
      f.calls.filter((c) => c.path.endsWith("/provider-sync")).length,
      1,
    );
  });
}

test("attachment preparation respects capability and text-only campaigns keep activation", async (t) => {
  const f = fixture(t);
  f.r.can = () => false;
  assert.doesNotMatch(
    f.page.render("campaigns"),
    /data-workspace-action="media-prepare"/,
  );
  await assert.rejects(f.page.action("media-prepare"));
  assert.equal(f.calls.length, 0);
  f.r.can = () => true;
  f.view.campaigns.campaign.mediaId = null;
  assert.match(
    f.page.render("campaigns"),
    /data-workspace-action="transition-activate"/,
  );
});

test("reopening a neutral API campaign uses its authorized attachment metadata to enable preparation", async (t) => {
  const view = { neutralApi: true },
    calls = [];
  const campaign = {
    campaignId: "campaign-one",
    revision: 4,
    status: "prepared",
    mediaId: "image-one",
    mediaReady: false,
    canActivate: false,
    assignedUserIds: [],
    templateText: "Example Team. Reply STOP to opt out.",
  };
  const page = createCampaigns({
    context: () => ({
      userId: "admin",
      organizationId: "example",
      section: "campaigns",
      resourceId: "campaign-one",
    }),
    view: () => view,
    workspace: () => ({}),
    billing: () => ({}),
    can: (key) => ["createCampaigns", "canPrepareProviderMedia"].includes(key),
    contactApi: { invalidate() {} },
    busy: () => false,
    guard() {},
    changed() {},
    api: async (path) => {
      calls.push(path);
      if (path === "/campaigns/campaign-one") return { campaign };
      if (path === "/campaigns/campaign-one/media/image-one/content")
        return {
          media: {
            mediaId: "image-one",
            state: "local_ready",
            providerReady: false,
            mimeType: "image/png",
            dataBase64: "aGVsbG8=",
          },
        };
      if (path === "/delivery-schedule")
        return {
          schedule: {
            status: "verified",
            timeZone: "America/Denver",
            startTime: "08:00",
            endTime: "20:00",
          },
        };
      throw Error(`Unexpected ${path}`);
    },
  });
  t.after(() => page.dispose());
  await page.load("campaign-one", "campaigns");
  assert.ok(calls.includes("/campaigns/campaign-one/media/image-one/content"));
  assert.match(
    page.render("campaigns"),
    /data-workspace-action="media-prepare"[^>]*>Prepare attachment/,
  );
  assert.doesNotMatch(
    page.render("campaigns"),
    /data-workspace-action="media-prepare"[^>]* disabled/,
  );
});
