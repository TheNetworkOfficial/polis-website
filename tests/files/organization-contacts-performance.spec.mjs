import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const load = async (name) =>
  import(
    `data:text/javascript;base64,${Buffer.from(await readFile(new URL(`../../frontend/src/pages/shared-feed/scripts/${name}.js`, import.meta.url))).toString("base64")}`
  );
const { createContactPageCache, createOrganizationContactsApi } = await load(
  "organizationContactsApi",
);
const { uploadSharedContactRows, acknowledgedContactRows } = await load(
  "organizationContactImport",
);
const page = (overrides = {}) => ({
  ok: true,
  items: [{ contactId: "a" }],
  accessFingerprint: "actor1",
  schemaRevision: "schema1",
  indexGeneration: 1,
  bookRevision: 1,
  queryHash: "query1",
  ...overrides,
});

test("page cache bounds bytes/pages, clones data, expires and isolates access/publication context", () => {
  let now = 0;
  const cache = createContactPageCache({
    maxPages: 2,
    maxBytes: 1000,
    now: () => now,
  });
  cache.put("org", { filter: { b: 2, a: 1 } }, page());
  const first = cache.get("org", { filter: { a: 1, b: 2 } });
  first.items[0].contactId = "changed";
  assert.equal(
    cache.get("org", { filter: { b: 2, a: 1 } }).items[0].contactId,
    "a",
  );
  assert.equal(cache.get("other", { filter: { a: 1, b: 2 } }), null);
  cache.put("org", { search: "two" }, page());
  cache.put("org", { search: "three" }, page());
  assert.equal(cache.size, 2);
  assert.equal(cache.get("org", { filter: { a: 1, b: 2 } }), null);
  cache.put("org", { search: "three" }, page({ bookRevision: 2 }));
  assert.equal(cache.size, 1);
  cache.put("org", { search: "four" }, page({ accessFingerprint: "actor2" }));
  assert.equal(cache.size, 1);
  now = 15000;
  assert.equal(cache.get("org", { search: "four" }), null);
  cache.put("org", {}, page({ items: ["x".repeat(1001)] }));
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
  cache.put("org", {}, page());
  cache.put(
    "org",
    { cursor: "next" },
    page({ publication: { status: "updating", pending: 3 } }),
  );
  assert.equal(cache.get("org", {}), null);
  assert.equal(cache.get("org", { cursor: "next" }).publication.pending, 3);
  cache.put("org", {}, page({ publication: { status: "ready", pending: 0 } }));
  assert.equal(cache.get("org", { cursor: "next" }), null);
  cache.put("org", {}, {});
  assert.equal(cache.size, 0);
});

test("query caching never authorizes writes and clears after writes/errors/auth drift", async () => {
  let calls = 0,
    active = true,
    fail = false;
  const api = createOrganizationContactsApi({
    scopeKey: "coalition:one",
    guard: () => {
      if (!active) throw Error("changed");
    },
    request: async () => {
      calls++;
      if (fail) throw Error("denied");
      return page();
    },
  });
  await api("/query", {});
  assert.equal((await api("/query", {})).fromCache, true);
  assert.equal(calls, 1);
  await api("/selections", {});
  await api("/query", {});
  assert.equal(calls, 3);
  await api("/query", {}, "POST", { refresh: true });
  assert.equal(calls, 4);
  fail = true;
  await assert.rejects(api("/query", {}, "POST", { refresh: true }));
  fail = false;
  await api("/query", {});
  assert.equal(calls, 6);
  active = false;
  await assert.rejects(api("/query", {}), /changed/);
  active = true;
  await api("/query", {});
  assert.equal(calls, 7);
});

test("cancelled or obsolete query response cannot repopulate pages", async () => {
  let calls = 0,
    finish;
  const controller = new AbortController();
  const api = createOrganizationContactsApi({
    scopeKey: "one",
    request: async (_path, options) => {
      calls++;
      if (calls > 1) return page();
      assert.equal(options.signal, controller.signal);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const request = api("/query", {}, "POST", {
    signal: controller.signal,
    isCurrent: () => false,
  });
  await Promise.resolve();
  controller.abort();
  finish(page());
  await request;
  const next = api("/query", {}, "POST", {
    signal: new AbortController().signal,
  });
  assert.equal((await next).fromCache, undefined);
  assert.equal(calls, 2);
});

test("partial acknowledgements replay exact tails, require completed file and retain publication state", async () => {
  const calls = [],
    progress = [];
  const rows = Array.from({ length: 105 }, (_, i) => `Person ${i},00${i}`);
  const result = await uploadSharedContactRows({
    file: new Blob(["name,id\n" + rows.join("\n")]),
    job: { importId: "job", operationId: "same" },
    guard() {},
    progress: (r) => progress.push(r.processed),
    api: async (path, body) => {
      calls.push({ path, body });
      if (!body.rows) {
        assert.equal(body.expectedRowCount, 105);
        return {
          import: { status: "complete" },
          publication: { status: "updating", pending: 105 },
        };
      }
      const processed = Math.min(17, body.rows.length);
      return {
        processedRows: processed,
        nextRow: body.startRow + processed,
        remainingRows: body.rows.length - processed,
        complete: processed === body.rows.length,
      };
    },
  });
  const submissions = calls.filter((c) => c.body.rows);
  assert.equal(submissions[1].body.startRow, 17);
  assert.equal(submissions[1].body.rows[0][1], "0017");
  assert.deepEqual(progress, [17, 34, 51, 68, 85, 100, 105]);
  assert.equal(result.publication.status, "updating");
  assert.ok(submissions.every((c) => c.body.rows.length <= 100));
});

test("zero or malformed acknowledgements pause without completion; maxRow detects shorter resume", async () => {
  for (const response of [
    { processedRows: 0, nextRow: 0, remainingRows: 1, complete: false },
    { processedRows: 1, nextRow: 2, remainingRows: 0, complete: true },
  ]) {
    let calls = 0;
    await assert.rejects(
      uploadSharedContactRows({
        file: new Blob(["name\nExample"]),
        job: { importId: "job", operationId: "same" },
        guard() {},
        progress() {},
        api: async () => {
          calls++;
          return response;
        },
      }),
    );
    assert.equal(calls, 1);
  }
  assert.throws(() =>
    acknowledgedContactRows(
      { processedRows: 0.5, nextRow: 0.5, remainingRows: 0.5, complete: false },
      0,
      1,
    ),
  );
  await assert.rejects(
    uploadSharedContactRows({
      file: new Blob(["name\nExample"]),
      job: { importId: "job", operationId: "same", maxRow: 3, accepted: 1 },
      guard() {},
      progress() {},
      api: async () => ({
        processedRows: 1,
        nextRow: 1,
        remainingRows: 0,
        complete: true,
      }),
    }),
    /shorter/,
  );
  await assert.rejects(
    uploadSharedContactRows({
      file: new Blob(["name\nExample"]),
      job: { importId: "job", operationId: "same" },
      guard() {},
      progress() {},
      api: async (_path, body) =>
        body.rows
          ? { processedRows: 1, nextRow: 1, remainingRows: 0, complete: true }
          : { import: { status: "open" } },
    }),
    /completed file/,
  );
});
const loadBook = async () => {
  let source = await readFile(
    new URL(
      "../../frontend/src/pages/shared-feed/scripts/organizationContactBook.js",
      import.meta.url,
    ),
    "utf8",
  );
  source = source.replace('import "../css/organization-contacts.css";', "");
  for (const module of [
    "textingWorkspaceUi",
    "organizationContactsModel",
    "organizationContactImport",
    "organizationContactPresentation",
  ]) {
    const dependency = await readFile(
      new URL(
        `../../frontend/src/pages/shared-feed/scripts/${module}.js`,
        import.meta.url,
      ),
      "utf8",
    );
    source = source.replace(
      `"./${module}"`,
      JSON.stringify(
        `data:text/javascript;base64,${Buffer.from(dependency).toString("base64")}`,
      ),
    );
  }
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
};
const { createOrganizationContactBook } = await loadBook();

test("publication banner labels partial results and clears after fresh ready response", async () => {
  const view = {};
  let ready = false;
  const runtime = {
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    contactApi: async (path) => {
      if (path === "/schema")
        return {
          fields: [],
          tags: [],
          capabilities: { read: true, select: true },
        };
      if (path === "/views" || path === "/audiences") return { items: [] };
      return {
        ...page(),
        complete: true,
        total: 1,
        publication: {
          status: ready ? "ready" : "updating",
          pending: ready ? 0 : 17,
        },
      };
    },
  };
  const book = createOrganizationContactBook(runtime);
  await book.load();
  assert.match(book.render(), /17 updates pending/);
  assert.match(book.render(), /1 published matches loaded/);
  assert.match(book.render(), /Select all published matches/);
  assert.doesNotMatch(book.render(), /1 matching contacts/);
  ready = true;
  await book.action("book-refresh");
  assert.doesNotMatch(book.render(), /Contacts updating|published matches/);
  assert.match(book.render(), /1 matching contacts/);
  book.dispose();
});

test("fixed pages preserve selections, bound cursor memory and fence obsolete requests", async (t) => {
  const view = {};
  let pending,
    late = false;
  const requests = [];
  const runtime = {
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    contactApi: async (path, body, _method, options) => {
      if (path === "/schema")
        return {
          fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
          tags: [],
          capabilities: { read: true, select: true },
        };
      if (path === "/views" || path === "/audiences") return { items: [] };
      requests.push({ body, options });
      const n = Number(body.cursor || 0);
      const value = {
        items: Array.from({ length: 50 }, (_, i) => ({
          contactId: `contact-${n + i}`,
          fields: { displayName: `Example ${n + i}` },
        })),
        nextCursor: String(n + 50),
        bookRevision: 1,
        ...(body.search
          ? { effectiveSort: { field: "best_match", direction: "asc" } }
          : {}),
      };
      if (late) {
        late = false;
        return new Promise((resolve) => (pending = () => resolve(value)));
      }
      return value;
    },
  };
  const book = createOrganizationContactBook(runtime);
  await book.load();
  view.contactBook.query.search = "neighbor";
  await book.action("book-refresh");
  assert.match(book.render(), /Best match/);
  assert.doesNotMatch(book.render(), /Sorted by Name/);
  delete view.contactBook.query.search;
  await book.action("book-refresh");
  assert.match(book.render(), /Sorted by Name, ascending/);
  assert.doesNotMatch(book.render(), /Best match/);
  book.change({
    dataset: { contactChange: "book-row", contactId: "contact-0" },
    checked: true,
  });
  for (let i = 0; i < 12; i++) await book.action("book-more");
  assert.equal(view.contactBook.rows.length, 50);
  assert.equal(view.contactBook.previousCursors.length, 8);
  assert.equal(view.contactBook.includeIds.has("contact-0"), true);
  await book.action("book-first");
  assert.equal(view.contactBook.rows[0].contactId, "contact-0");
  assert.match(book.render(), /1 selected/);
  late = true;
  const old = book.action("book-more");
  await Promise.resolve();
  const stale = requests.at(-1);
  await book.action("book-refresh");
  assert.equal(stale.options.signal.aborted, true);
  pending();
  await old;
  assert.equal(view.contactBook.rows[0].contactId, "contact-0");
  assert.equal(view.contactBook.includeIds.size, 1);
  const times = [];
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    book.change({
      dataset: { contactChange: "book-row", contactId: "contact-0" },
      checked: i % 2 === 0,
    });
    book.render();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  t.diagnostic(
    `Desktop JS selection+50-row markup p95=${times[94].toFixed(3)}ms p99=${times[98].toFixed(3)}ms; excludes browser paint and device/network.`,
  );
  book.dispose();
});
test("index preparation is explicit, budget pauses are visible, and ready retries the query", async () => {
  const view = {};
  let ready = false;
  const writes = [];
  const runtime = {
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    contactApi: async (path, body) => {
      if (path === "/schema")
        return {
          fields: [],
          tags: [],
          capabilities: { read: true, select: true, manage: true },
        };
      if (path === "/views" || path === "/audiences") return { items: [] };
      if (path === "/query") {
        if (!ready)
          throw Object.assign(Error("prepare"), {
            payload: {
              error: "contact_index_preparation_required",
              details: { fieldId: "custom_tax", operation: "equality" },
            },
          });
        return {
          items: [{ contactId: "one", fields: { displayName: "Example" } }],
          complete: true,
        };
      }
      writes.push({ path, body });
      if (path.endsWith("/resume"))
        return {
          job: {
            id: "index1",
            status: "preparing",
            processedContacts: 25,
            workUsed: 25,
            workBudget: 50,
          },
        };
      if (path.endsWith("/advance")) {
        if (writes.some((row) => row.path.endsWith("/resume"))) {
          ready = true;
          return {
            job: {
              id: "index1",
              status: "ready",
              processedContacts: 50,
              workUsed: 50,
              workBudget: 50,
            },
          };
        }
        return {
          job: {
            id: "index1",
            status: "paused",
            processedContacts: 25,
            workUsed: 25,
            workBudget: 25,
            pauseReason: "work_budget_exhausted",
          },
        };
      }
      return {
        job: {
          id: "index1",
          status: "preparing",
          processedContacts: 0,
          workUsed: 0,
          workBudget: 25,
        },
      };
    },
  };
  const book = createOrganizationContactBook(runtime);
  await assert.rejects(book.load(), /prepare/);
  assert.equal(writes.length, 0);
  assert.match(book.render(), /Prepare search index/);
  await book.action("book-index-prepare");
  assert.match(book.render(), /Resume index preparation/);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.fieldId, "custom_tax");
  assert.equal(writes[0].body.operation, "equality");
  await book.action("book-index-prepare");
  assert.equal(view.contactBook.rows.length, 1);
  assert.equal(view.contactBook.indexRequirement, null);
  assert.ok(writes[2].body.operationId);
  book.dispose();
});

test("readers get manager-needed guidance and cannot mutate preparation", async () => {
  const view = {};
  const runtime = {
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    contactApi: async (path) => {
      if (path === "/schema")
        return { fields: [], tags: [], capabilities: { read: true } };
      if (path === "/views" || path === "/audiences") return { items: [] };
      if (path === "/query")
        throw Object.assign(Error("prepare"), {
          payload: {
            error: "contact_index_preparation_required",
            details: { fieldId: "custom_tax", operation: "sort" },
          },
        });
      throw Error("unexpected write");
    },
  };
  const book = createOrganizationContactBook(runtime);
  await assert.rejects(book.load());
  assert.match(book.render(), /Ask a contact manager/);
  assert.doesNotMatch(
    book.render(),
    /data-workspace-action="book-index-prepare"/,
  );
  await assert.rejects(book.action("book-index-prepare"), /manager/);
  book.dispose();
});
