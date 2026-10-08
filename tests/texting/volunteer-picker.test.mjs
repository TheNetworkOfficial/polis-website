import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createVolunteerPicker } = await import(
  await moduleUrl("textingVolunteerPicker")
);
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const flush = () => new Promise(setImmediate);
function fixture(api = async () => ({ members: [] })) {
  const state = {
    campaign: {
      campaignId: "example",
      status: "draft",
      revision: 2,
      assignedUserIds: [],
    },
    selected: new Set(),
  };
  const timers = new Map(),
    calls = [],
    failures = [];
  let timerId = 0,
    allowed = true,
    active = true;
  const runtime = {
    can: () => allowed,
    busy: () => false,
    changed: () => {},
    guard: () => {
      if (!active) throw new Error("Workspace changed");
    },
    fail: (error) => failures.push(error.status),
    api: (...args) => {
      calls.push(args);
      return api(...args);
    },
  };
  const picker = createVolunteerPicker(runtime, () => state, {
    schedule: (fn) => {
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  return {
    state,
    picker,
    calls,
    failures,
    type: (value) =>
      picker.change({ dataset: { workspaceVolunteerQuery: "true" }, value }),
    tick: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
    },
    allowed: (value) => {
      allowed = value;
    },
    active: (value) => {
      active = value;
    },
    timerCount: () => timers.size,
  };
}

test("name typing is debounced, bounded and uses only the scoped eligible member GET", async () => {
  const h = fixture(async () => ({
    members: [{ userId: "alex", displayName: "Alex Example" }],
  }));
  h.type("A");
  assert.equal(h.calls.length, 0);
  h.type("Al");
  h.type("Ale");
  h.type("Alex");
  assert.equal(h.timerCount(), 1);
  assert.equal(h.calls.length, 0);
  h.tick();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "/members?query=Alex&limit=20");
  assert.equal(h.calls[0][1], undefined);
  assert.ok(h.calls[0][3].signal instanceof AbortSignal);
  h.type("Alex");
  h.tick();
  assert.equal(
    h.calls.length,
    1,
    "duplicate input/change must not repeat search",
  );
  assert.match(h.picker.render(), /1 matching teammate/);
  assert.doesNotMatch(h.picker.render(), />Search</);
  h.type("");
  assert.deepEqual(h.state.members, []);
  assert.match(h.picker.render(), /Type a name or @username/);
});

test("out-of-order responses are ignored even when the transport ignores cancellation", async () => {
  const pending = [];
  const h = fixture(() => new Promise((resolve) => pending.push(resolve)));
  h.type("Ale");
  h.tick();
  const oldSignal = h.calls[0][3].signal;
  h.type("Bla");
  h.tick();
  assert.equal(oldSignal.aborted, true);
  pending[1]({ members: [{ userId: "blair", displayName: "Blair Example" }] });
  await flush();
  pending[0]({ members: [{ userId: "alex", displayName: "Alex Example" }] });
  await flush();
  assert.deepEqual(
    h.state.members.map((member) => member.userId),
    ["blair"],
  );
  assert.doesNotMatch(h.picker.render(), /Alex Example/);
});

test("selected volunteers keep their names and photos while the next name is searched", async () => {
  const h = fixture(async (path) => ({
    members: path.includes("Alex")
      ? [
          {
            userId: "alex",
            displayName: "Alex Example",
            avatarUrl: "https://profiles.example.test/alex.png",
          },
        ]
      : [
          {
            userId: "blair",
            displayName: "Blair Example",
            avatarUrl: "javascript:alert(1)",
          },
        ],
  }));
  h.type("Alex");
  h.tick();
  await flush();
  h.state.selected.add("alex");
  h.type("Blair");
  assert.match(h.picker.render(), /Alex Example/);
  h.tick();
  await flush();
  const html = h.picker.render();
  assert.match(html, /https:\/\/profiles.example.test\/alex.png/);
  assert.match(html, /data-workspace-member="alex" checked/);
  assert.match(html, /Select Blair Example/);
  assert.match(html, />BE<\/span>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.deepEqual([...h.state.selected], ["alex"]);
  h.picker.avatarError({ src: "https://profiles.example.test/alex.png" });
  assert.doesNotMatch(
    h.picker.render(),
    /<img src="https:\/\/profiles.example.test\/alex.png/,
  );
  assert.match(h.picker.render(), />AE<\/span>/);
  assert(
    h.calls.every((call) => call[1] === undefined),
    "search never assigns or grants permissions",
  );
});

test("disposal and actor changes cannot publish late member results", async () => {
  for (const dispose of [false, true]) {
    let finish;
    const h = fixture(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.type("Alex");
    h.tick();
    if (dispose) {
      h.picker.dispose();
      assert.equal(h.calls[0][3].signal.aborted, true);
    } else h.active(false);
    finish({ members: [{ userId: "secret", displayName: "Previous org" }] });
    await flush();
    assert.deepEqual(h.state.members, []);
    assert.equal(h.state.memberProfiles?.size || 0, 0);
  }
});

test("revocation clears member profiles and uses the workspace access failure path", async () => {
  const error = Object.assign(new Error("Denied"), { status: 403 });
  const h = fixture(async () => {
    throw error;
  });
  h.state.memberProfiles = new Map([["old", { displayName: "Old member" }]]);
  h.type("Alex");
  h.tick();
  await flush();
  assert.deepEqual(h.failures, [403]);
  assert.deepEqual(h.state.members, []);
  assert.equal(h.state.memberProfiles.size, 0);
  h.allowed(false);
  h.type("Blair");
  h.tick();
  assert.equal(h.calls.length, 1);
  assert.match(
    h.picker.render(),
    /aria-controls="volunteer-search-results" disabled/,
  );
});

test("transient errors keep selection and provide a retry message without automatic polling", async () => {
  const h = fixture(async () => {
    throw new Error("Network unavailable");
  });
  h.state.selected.add("selected");
  h.type("Alex");
  h.tick();
  await flush();
  assert.match(h.picker.render(), /press Enter to try again/);
  assert.deepEqual([...h.state.selected], ["selected"]);
  assert.equal(h.timerCount(), 0);
  assert.equal(h.calls.length, 1);
});

test("campaign team integration keeps native checkboxes and escaping without a search button", () => {
  const campaigns = {
    campaign: {
      campaignId: "team",
      name: "Example team",
      status: "draft",
      assignedUserIds: ["a"],
    },
    selected: new Set(["a"]),
    members: [
      {
        userId: "a",
        displayName: '<img onerror="bad">',
        avatarUrl: "https://example.test/a.png",
      },
    ],
  };
  const page = createCampaigns({
    view: () => ({ campaigns }),
    can: () => true,
    busy: () => false,
    context: () => ({ resourceId: "team" }),
  });
  const html = page.render("team");
  assert.match(html, /Start typing a name/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /data-workspace-volunteer-avatar/);
  assert.match(html, /&lt;img onerror=/);
  assert.doesNotMatch(html, /<img onerror=/);
  assert.match(html, /data-workspace-member="a" checked/);
  assert.doesNotMatch(html, />Search</);
  assert.match(html, /Assignment does not grant organization permissions/);
});

test("assigned profiles load once without typing, page explicitly and preserve search selections", async () => {
  const h = fixture(async (path) => ({
    campaignId: "example",
    campaignRevision: 2,
    members: path.includes("cursor=")
      ? [{ userId: "b", displayName: "Blair Existing" }]
      : [
          {
            userId: "a",
            displayName: "Alex Existing",
            avatarUrl: "https://profiles.example.test/a.png",
          },
        ],
    nextCursor: path.includes("cursor=") ? null : "opaque-token",
  }));
  h.state.campaign.assignedUserIds = ["a", "b"];
  h.state.selected = new Set(["a", "b", "new"]);
  h.state.members = [{ userId: "new", displayName: "New Teammate" }];
  await h.picker.loadAssigned();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "/campaigns/example/team?limit=50");
  assert.match(h.picker.render(), /Alex Existing/);
  assert.match(h.picker.render(), /New Teammate/);
  assert.match(h.picker.render(), /Load more teammate profiles/);
  await h.picker.action("members-more");
  assert.equal(h.calls.length, 2);
  assert.equal(
    h.calls[1][0],
    "/campaigns/example/team?limit=50&cursor=opaque-token",
  );
  assert.match(h.picker.render(), /Blair Existing/);
  assert.doesNotMatch(h.picker.render(), /Load more teammate profiles/);
  assert.deepEqual([...h.state.selected], ["a", "b", "new"]);
  assert(h.calls.every((call) => call[1] === undefined));
});

test("assignment revisions clear profile cursors and abort stale profile pages", async () => {
  const pending = [];
  const h = fixture(() => new Promise((resolve) => pending.push(resolve)));
  h.state.campaign.assignedUserIds = ["a"];
  h.state.selected.add("a");
  const first = h.picker.loadAssigned();
  h.state.memberProfileCursor = "old-cursor";
  h.state.campaign = {
    ...h.state.campaign,
    revision: 3,
    assignedUserIds: ["b"],
  };
  h.picker.invalidateAssigned();
  assert.equal(h.calls[0][3].signal.aborted, true);
  assert.equal(h.state.memberProfileCursor, null);
  pending[0]({
    campaignId: "example",
    campaignRevision: 2,
    members: [{ userId: "a", displayName: "Stale profile" }],
    nextCursor: "old-cursor",
  });
  await first;
  assert.equal(h.state.memberProfiles?.size || 0, 0);
  const fresh = h.picker.loadAssigned();
  assert.equal(h.calls[1][0], "/campaigns/example/team?limit=50");
  pending[1]({
    campaignId: "example",
    campaignRevision: 3,
    members: [{ userId: "b", displayName: "Current profile" }],
    nextCursor: null,
  });
  await fresh;
  assert.match(h.picker.render(), /Current profile/);
  assert.doesNotMatch(h.picker.render(), /Stale profile/);
});

test("team changes require assignment refresh, and revoked profile access clears private rows", async () => {
  for (const status of [403, 409]) {
    const h = fixture(async () => {
      throw Object.assign(new Error("Changed"), { status });
    });
    h.state.campaign.assignedUserIds = ["a"];
    h.state.selected.add("a");
    h.state.memberProfiles = new Map([
      ["a", { userId: "a", displayName: "Existing profile" }],
    ]);
    h.state.memberProfileCursor = "old-cursor";
    await h.picker.loadAssigned();
    if (status === 403) {
      assert.deepEqual(h.failures, [403]);
      assert.equal(h.state.memberProfiles.size, 0);
    } else {
      assert.equal(h.state.assignmentsNeedRead, true);
      assert.equal(h.state.memberProfileCursor, null);
      assert.deepEqual([...h.state.selected], ["a"]);
      assert.doesNotMatch(h.picker.render(), /Load more teammate profiles/);
    }
    assert.equal(h.calls.length, 1);
  }
});

test("empty team does not fetch profiles, while archived team names remain readable", async () => {
  const h = fixture(async () => ({
    campaignId: "example",
    campaignRevision: 2,
    members: [{ userId: "a", displayName: "Archived teammate" }],
    nextCursor: null,
  }));
  await h.picker.loadAssigned();
  assert.equal(h.calls.length, 0);
  h.state.campaign = {
    ...h.state.campaign,
    status: "archived",
    assignedUserIds: ["a"],
  };
  await h.picker.loadAssigned();
  assert.equal(h.calls.length, 1);
  assert.match(h.picker.render(), /Archived teammate/);
  assert.match(h.picker.render(), /data-workspace-member="a" disabled/);
});

test("one- and two-character names support sparse scoped pagination while retaining selected teammates", async () => {
  const h = fixture(async (path) => {
    const query = new URL(`https://example.test${path}`).searchParams;
    if (query.get("query") === "Q")
      return { members: [{ userId: "q", displayName: "Q" }], nextCursor: null };
    if (!query.get("cursor"))
      return { members: [], nextCursor: "roster-page-2" };
    if (query.get("cursor") === "roster-page-2")
      return {
        members: [{ userId: "li", displayName: "Li Example" }],
        nextCursor: "roster-page-3",
      };
    return {
      members: [{ userId: "lin", displayName: "Lin Example" }],
      nextCursor: null,
    };
  });
  h.type("Q");
  h.tick();
  await flush();
  assert.equal(h.state.members[0].displayName, "Q");
  h.state.selected.add("q");
  h.type("Li");
  h.tick();
  await flush();
  assert.equal(h.state.members.length, 0);
  assert.match(h.picker.render(), /Keep searching/);
  assert.match(h.picker.render(), /Find more teammates/);
  await h.picker.action("member-search-more");
  assert.equal(
    h.calls.at(-1)[0],
    "/members?query=Li&limit=20&cursor=roster-page-2",
  );
  h.state.selected.add("li");
  await h.picker.action("member-search-more");
  assert.deepEqual(
    h.state.members.map((member) => member.userId),
    ["li", "lin"],
  );
  assert.match(h.picker.render(), /Select Q/);
  assert.match(h.picker.render(), /Select Li Example/);
  assert.doesNotMatch(
    h.picker.render(),
    /data-workspace-action="member-search-more"/,
  );
  assert.ok(h.calls.every(([, body]) => body === undefined));
  h.picker.dispose();
});

test("an older paginated search cannot populate a changed name, and a failed page keeps its retry cursor", async () => {
  let resolvePage,
    fail = true;
  const h = fixture(async (path) => {
    if (path.includes("query=Blair"))
      return { members: [{ userId: "blair", displayName: "Blair Example" }] };
    if (!path.includes("cursor="))
      return {
        members: [{ userId: "alex", displayName: "Alex Example" }],
        nextCursor: "next",
      };
    if (fail) {
      fail = false;
      throw new TypeError("Network unavailable");
    }
    return new Promise((resolve) => {
      resolvePage = resolve;
    });
  });
  h.type("Alex");
  h.tick();
  await flush();
  await h.picker.action("member-search-more");
  assert.equal(h.state.members[0].userId, "alex");
  assert.equal(h.state.memberSearchCursor, "next");
  assert.match(h.picker.render(), /Retry finding more teammates/);
  const old = h.picker.action("member-search-more");
  h.type("Blair");
  h.tick();
  await flush();
  resolvePage({
    members: [{ userId: "another", displayName: "Alex Second" }],
    nextCursor: "old-next",
  });
  await old;
  assert.deepEqual(
    h.state.members.map((member) => member.userId),
    ["blair"],
  );
  assert.equal(h.state.memberSearchCursor, null);
  h.picker.dispose();
});
