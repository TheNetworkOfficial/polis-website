import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { createOrganizationContactBook } = await import(
  await moduleUrl("organizationContactBook")
);
const { createContactProgress } = await import(
  await moduleUrl("organizationContactProgress")
);
const { createCampaignDraftStore } = await import(
  await moduleUrl("textingCampaignDraft")
);
const settle = () => new Promise(setImmediate);
const row = (n) => ({
  contactId: `contact-${n}`,
  fields: { displayName: `Person ${n}`, phone: "+12025550123" },
  eligibility: { status: "eligible" },
  tags: [],
});
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
};
function harness(
  t,
  contactRequest,
  { storage = memory(), userId = "admin", organizationId = "example" } = {},
) {
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = storage;
  const view = {},
    calls = [],
    failures = [];
  const runtime = {
    view: () => view,
    context: () => ({
      userId,
      organizationId,
      section: "campaigns",
      resourceId: "new",
    }),
    can: () => true,
    busy: () => false,
    guard() {},
    changed() {},
    fail(error) {
      failures.push(error);
    },
    workspace: () => ({}),
    billing: () => ({ rates: {} }),
    navigate() {},
    toast() {},
    api: async (path, body) => {
      calls.push({ path, body, kind: "texting" });
      if (path === "/delivery-schedule")
        return { schedule: { status: "verified" } };
      throw new Error(`Unexpected texting write: ${path}`);
    },
    contactApi: async (path, body, method, options) => {
      calls.push({ path, body, method, kind: "contacts" });
      if (path === "/schema")
        return {
          fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
          tags: [],
          capabilities: {
            read: true,
            select: true,
            campaign: true,
            queryCounts: true,
            backgroundSelections: true,
          },
        };
      return contactRequest(path, body, options);
    },
  };
  const campaign = createCampaigns(runtime);
  t.after(() => {
    campaign.dispose();
    if (previous === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous;
  });
  return { campaign, runtime, view, calls, failures, storage };
}
const firstPage = {
  items: Array.from({ length: 50 }, (_, n) => row(n)),
  total: 100000,
  bookRevision: 4,
  nextCursor: "next-page",
};

test("partial and empty query responses fill logical pages while exact totals arrive independently", async (t) => {
  let releaseCount, releaseTail;
  const view = {},
    calls = [];
  const runtime = {
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    fail(error) {
      throw error;
    },
    contactApi: async (path, body) => {
      calls.push({ path, body });
      if (path === "/schema")
        return {
          fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
          capabilities: {
            read: true,
            select: true,
            queryCounts: true,
            backgroundSelections: true,
          },
        };
      if (path === "/query-counts")
        return new Promise((resolve) => {
          releaseCount = resolve;
        });
      if (!body.cursor)
        return {
          items: [row(1), row(2)],
          nextCursor: "sparse-one",
          bookRevision: 4,
          total: null,
        };
      if (body.cursor === "sparse-one")
        return {
          items: [],
          nextCursor: "sparse-two",
          bookRevision: 4,
          total: null,
        };
      if (body.cursor === "sparse-two")
        return new Promise((resolve) => {
          releaseTail = resolve;
        });
      throw new Error(path);
    },
  };
  const book = createOrganizationContactBook(runtime);
  t.after(book.dispose);
  await book.load();
  await settle();
  assert.match(book.render(), /Counting matching contacts/);
  assert.doesNotMatch(book.render(), /Page 1 of/);
  assert.match(book.render(), /Loading page/);
  releaseCount({
    job: { countId: "count-a", status: "ready", total: 73, bookRevision: 4 },
  });
  releaseTail({
    items: Array.from({ length: 48 }, (_, n) => row(n + 3)),
    nextCursor: "logical-page-two",
    bookRevision: 4,
  });
  await settle();
  assert.equal(view.contactBook.rows.length, 50);
  assert.equal(view.contactBook.pageFilling, false);
  assert.equal(view.contactBook.cursor, "logical-page-two");
  assert.match(book.render(), /Page 1 of 2/);
  assert.deepEqual(
    calls
      .filter((call) => call.path === "/query")
      .map((call) => call.body.limit),
    [50, 48, 48],
  );
});

test("contact job polling is single-flight and stops after disposal", async () => {
  const timers = [],
    calls = [],
    accepted = [];
  let finish,
    state = "counting";
  const progress = createContactProgress(
    { changed() {}, guard() {} },
    {
      read: () => {
        calls.push("GET");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      accept: (job) => {
        state = job.status;
        accepted.push(job);
      },
      pending: () => state === "counting",
      failed() {},
      schedule: (fn) => {
        timers.push(fn);
        return fn;
      },
      cancel() {},
    },
  );
  const first = progress.refresh();
  void progress.refresh();
  assert.equal(calls.length, 1);
  finish({ status: "counting", counted: 250 });
  await first;
  assert.equal(timers.length, 1);
  timers[0]();
  await settle();
  assert.equal(calls.length, 2);
  progress.dispose();
  finish({ status: "ready", total: 1000 });
  await settle();
  assert.equal(accepted.length, 1);
});

test("draft storage excludes payloads, expires, and isolates users and organizations", () => {
  const storage = memory();
  let now = 1000000;
  const owner = createCampaignDraftStore(
    { userId: "one", organizationId: "org" },
    { storage, now: () => now },
  );
  owner.save(
    {
      campaignId: "draft",
      templateText: "My message",
      mediaPayload: "PRIVATE_BYTES",
      contactRows: [row(1)],
    },
    { spec: { mode: "all_matching", query: {} }, selectionId: "job" },
    "message",
  );
  assert.equal(owner.read().draft.templateText, "My message");
  assert.doesNotMatch(
    [...storage.values.values()][0],
    /PRIVATE_BYTES|contactRows|Person 1/,
  );
  for (const identity of [
    { userId: "two", organizationId: "org" },
    { userId: "one", organizationId: "other" },
  ])
    assert.equal(
      createCampaignDraftStore(identity, { storage, now: () => now }).read(),
      null,
    );
  now += 8 * 86400000;
  assert.equal(owner.read(), null);
  assert.equal(storage.values.size, 0);
});

test("an obsolete background selection response cannot revive an unchecked selection", async (t) => {
  let release;
  const h = harness(t, async (path) => {
    if (path === "/query") return firstPage;
    if (path === "/selections")
      return new Promise((resolve) => {
        release = resolve;
      });
    throw new Error(path);
  });
  await h.campaign.load("new", "campaigns");
  await h.campaign.action("recipients-select-all");
  await h.campaign.action("campaign-next");
  await h.campaign.action("recipients-select-clear");
  release({
    selection: { selectionId: "old", status: "ready", count: 100000 },
  });
  await settle();
  assert.equal(h.view.recipientBook.selection, null);
  assert.match(h.campaign.render("campaigns"), /disabled>Save campaign/);
});

test("all 100,000 matching contacts opens composer before any selection request finishes", async (t) => {
  let release;
  const h = harness(t, async (path) => {
    if (path === "/query") return firstPage;
    if (path === "/selections")
      return new Promise((resolve) => {
        release = resolve;
      });
    throw new Error(path);
  });
  await h.campaign.load("new", "campaigns");
  await h.campaign.action("recipients-select-all");
  assert.match(h.campaign.render("campaigns"), /All 100,000 matching contacts/);
  assert.match(h.campaign.render("campaigns"), /Page 1 of 2,000/);
  await h.campaign.action("campaign-next");
  assert.equal(h.view.campaigns.composeStep, "message");
  const html = h.campaign.render("campaigns");
  assert.match(html, /id="campaign-message"/);
  assert.match(html, /Preparing recipients/);
  assert.match(html, /disabled>Save campaign/);
  const post = h.calls.find((call) => call.path === "/selections");
  assert.equal(post.body.background, true);
  assert.equal(post.body.mode, "all_matching");
  assert.equal(post.body.expectedBookRevision, 4);
  assert.equal(
    h.calls.some((call) => /advance|provider|\/campaign$/.test(call.path)),
    false,
  );
  assert.ok(release);
  release({
    selection: { selectionId: "selection-a", status: "building", count: 0 },
  });
  await settle();
});

test("reload restores draft and job reference, rechecks review, and never recreates or exports recipients", async (t) => {
  const storage = memory();
  const request = async (path) => {
    if (path === "/query") return firstPage;
    if (path === "/selections")
      return {
        selection: {
          selectionId: "selection-a",
          status: "building",
          count: 25,
        },
      };
    if (path === "/selections/selection-a")
      return {
        selection: {
          selectionId: "selection-a",
          status: "ready",
          count: 100000,
          eligibleCount: 99000,
          excludedCount: 1000,
          manifestSha256: "manifest-a",
        },
      };
    if (path.endsWith("/contacts")) return { items: [row(1)] };
    throw new Error(path);
  };
  const first = harness(t, request, { storage });
  await first.campaign.load("new", "campaigns");
  await first.campaign.action("recipients-select-all");
  await first.campaign.action("campaign-next");
  await settle();
  first.view.campaigns.draft.templateText =
    "Example Team: hello. Reply STOP to opt out.";
  first.view.campaigns.draft.name = "Draft survives reload";
  first.campaign.render("campaigns");
  first.campaign.dispose();
  const saved = [...storage.values.values()][0];
  assert.doesNotMatch(
    saved,
    /Person 1|12025550123|selectedRows|dataBase64|exportGrant/,
  );
  const second = harness(t, request, { storage });
  await second.campaign.load("new", "campaigns");
  await settle();
  assert.equal(second.view.campaigns.composeStep, "message");
  assert.equal(second.view.campaigns.draft.name, "Draft survives reload");
  assert.equal(
    second.view.campaigns.draft.templateText,
    first.view.campaigns.draft.templateText,
  );
  assert.equal(second.view.recipientBook.selection.status, "ready");
  assert.equal(second.view.recipientBook.reviewed, undefined);
  assert.equal(
    second.calls.some((call) => call.path === "/selections"),
    false,
  );
  assert.equal(
    second.calls.filter((call) => call.path === "/selections/selection-a")
      .length,
    1,
  );
  await second.campaign.action("recipients-selection-review");
  await settle();
  second.campaign.change({
    dataset: { contactChange: "recipients-reviewed" },
    checked: true,
  });
  assert.equal(second.view.recipientBook.reviewed, true);
  assert.doesNotMatch(
    second.campaign.render("campaigns"),
    /disabled>Save campaign/,
  );
  assert.equal(
    second.calls.some((call) => /provider|\/campaign$|advance/.test(call.path)),
    false,
  );
});

test("sparse logical pages have a bounded read budget and resume on the same page", async (t) => {
  const view = {};
  let queries = 0;
  const book = createOrganizationContactBook({
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    fail(error) {
      throw error;
    },
    contactApi: async (path) => {
      if (path === "/schema")
        return { fields: [], capabilities: { read: true, select: true } };
      if (path === "/views" || path === "/audiences") return { items: [] };
      assert.equal(path, "/query");
      queries++;
      return {
        items: [],
        nextCursor: `page-${queries}`,
        total: null,
        bookRevision: 1,
      };
    },
  });
  t.after(book.dispose);
  await book.load();
  await settle();
  assert.equal(queries, 11);
  assert.equal(view.contactBook.pageNumber, 1);
  assert.equal(view.contactBook.pagePaused, true);
  assert.match(book.render(), /Resume loading page/);
  assert.match(book.render(), /disabled>Next page/);
  assert.doesNotMatch(book.render(), /Counting matching contacts|Page 1 of/);
  await book.action("book-page-resume");
  await settle();
  assert.equal(queries, 21);
  assert.equal(view.contactBook.pageNumber, 1);
});

test("selected-all count remains tied to its frozen query when browsing changes", async (t) => {
  const h = harness(t, async (path) => {
    if (path === "/query") return firstPage;
    throw new Error(path);
  });
  await h.campaign.load("new", "campaigns");
  await h.campaign.action("recipients-select-all");
  const state = h.view.recipientBook;
  state.query = { ...state.query, search: "A different browsing query" };
  state.total = 4;
  const html = h.campaign.render("campaigns");
  assert.match(html, /All 100,000 matching contacts/);
  assert.doesNotMatch(html, /All 4 matching contacts/);
});

test("polling retries uncertain transient responses and bounds silent recovery attempts", async () => {
  const timers = [],
    attempts = [],
    accepted = [];
  let now = 1000000,
    uncertain = true;
  const progress = createContactProgress(
    { changed() {}, guard() {} },
    {
      read: async (options) => {
        attempts.push(options);
        if (uncertain) {
          uncertain = false;
          throw new Error("Response lost after acceptance");
        }
        return { status: "building", count: 0 };
      },
      accept: (job) => accepted.push(job),
      pending: () => true,
      failed(error) {
        throw error;
      },
      schedule: (fn) => {
        timers.push(fn);
        return fn;
      },
      cancel() {},
      now: () => now,
      recoverAfterMs: 150000,
    },
  );
  await progress.refresh();
  assert.equal(attempts.length, 1);
  timers.shift()();
  await settle();
  assert.equal(accepted.length, 1);
  for (let n = 0; n < 3; n++) {
    now += 150001;
    timers.shift()();
    await settle();
  }
  assert.equal(attempts.filter((attempt) => attempt.recover).length, 2);
  progress.dispose();
});

test("retry after an uncertain selection response retains the exact intent and operation key", async (t) => {
  const bodies = [];
  const h = harness(t, async (path, body) => {
    if (path === "/query") return firstPage;
    if (path === "/selections") {
      bodies.push(structuredClone(body));
      if (bodies.length === 1) throw new Error("Response lost");
      return {
        selection: { selectionId: "saved-job", status: "building", count: 0 },
      };
    }
    throw new Error(path);
  });
  await h.campaign.load("new", "campaigns");
  await h.campaign.action("recipients-select-all");
  await h.campaign.action("campaign-next");
  await settle();
  await h.campaign.action("recipients-selection-advance");
  await settle();
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(h.view.recipientBook.selection.selectionId, "saved-job");
});

test("a fresh contact-book handoff cannot reuse a restored reviewed selection", async (t) => {
  const storage = memory();
  createCampaignDraftStore(
    { userId: "admin", organizationId: "example" },
    { storage },
  ).save(
    {
      campaignId: "draft-existing",
      name: "Saved draft",
      templateText: "Saved message",
    },
    {
      spec: {
        mode: "explicit",
        query: { sort: { field: "displayName", direction: "asc" } },
        includeIds: ["old-person"],
        excludeIds: [],
      },
      selectionId: "old-reviewed-job",
      operationId: "old-operation",
      started: true,
      reviewed: {
        selectionId: "old-reviewed-job",
        manifestSha256: "old-manifest",
      },
    },
    "recipients",
  );
  const h = harness(
    t,
    async (path, body) => {
      if (path === "/query") return firstPage;
      if (path === "/selections") {
        assert.deepEqual(body.includeIds, ["new-person"]);
        assert.notEqual(body.operationId, "old-operation");
        return {
          selection: { selectionId: "new-job", status: "building", count: 0 },
        };
      }
      throw new Error(`Old job must not be fetched: ${path}`);
    },
    { storage },
  );
  h.runtime.takeContactCampaign = () => ({
    mode: "explicit",
    query: { sort: { field: "displayName", direction: "asc" } },
    includeIds: ["new-person"],
    excludeIds: [],
    expectedBookRevision: 4,
  });
  await h.campaign.load("new", "campaigns");
  await settle();
  assert.equal(h.view.campaigns.composeStep, "message");
  assert.equal(h.view.recipientBook.selection.selectionId, "new-job");
  assert.equal(h.view.recipientBook.reviewed, false);
  assert.match(h.campaign.render("campaigns"), /disabled>Save campaign/);
  assert.equal(
    h.calls.some((call) => call.path.includes("old-reviewed-job")),
    false,
  );
});

test("an uncertain explicit selection keeps its original body across browsing changes and reload", async (t) => {
  const storage = memory(),
    bodies = [];
  const request = async (path, body) => {
    if (path === "/query") return firstPage;
    if (path === "/selections") {
      bodies.push(structuredClone(body));
      if (bodies.length === 1)
        throw new Error("Response lost after durable acceptance");
      return {
        selection: {
          selectionId: "explicit-job",
          status: "building",
          count: 0,
        },
      };
    }
    throw new Error(path);
  };
  const first = harness(t, request, { storage });
  await first.campaign.load("new", "campaigns");
  first.campaign.change({
    dataset: { contactChange: "recipients-row", contactId: "contact-1" },
    checked: true,
  });
  await first.campaign.action("campaign-next");
  await settle();
  first.view.recipientBook.query = {
    ...first.view.recipientBook.query,
    search: "different search",
  };
  first.campaign.render("campaigns");
  first.campaign.dispose();
  const second = harness(t, request, { storage });
  await second.campaign.load("new", "campaigns");
  await settle();
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(bodies[1].includeIds, ["contact-1"]);
  assert.equal(second.view.recipientBook.selection.selectionId, "explicit-job");
});
