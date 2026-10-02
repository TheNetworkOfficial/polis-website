import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createOrganizationContactBook } = await import(
  await moduleUrl("organizationContactBook")
);
const { contactPageWindow, contactDirectoryHasPage } = await import(
  await moduleUrl("organizationContactPagination")
);
const { createOrganizationContactsApi } = await import(
  await moduleUrl("organizationContactsApi")
);
const settle = () => new Promise(setImmediate);
const contact = (n) => ({
  contactId: `person-${n}`,
  fields: { displayName: `Example ${n}` },
  eligibility: { status: "eligible" },
});
function fixture(
  t,
  { total = 100003, job, pageRead, firstTotal = total } = {},
) {
  const view = {},
    calls = [],
    failures = [],
    timers = [];
  const runtime = {
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    fail(error) {
      failures.push(error);
    },
    contactApi: async (path, body, method, options) => {
      calls.push({ path, body, method, options });
      if (path === "/schema")
        return {
          fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
          capabilities: {
            read: true,
            select: true,
            campaign: true,
            queryCounts: true,
            numberedPages: true,
          },
        };
      if (path === "/views" || path === "/audiences") return { items: [] };
      if (path === "/query")
        return {
          items: Array.from({ length: Math.min(body.limit, total) }, (_, i) =>
            contact(i),
          ),
          bookRevision: 7,
          total: firstTotal,
          nextCursor: total > body.limit ? "next" : null,
          complete: total <= body.limit,
        };
      if (path === "/query-counts" || path === "/query-counts/count-a")
        return {
          job: job
            ? job()
            : {
                countId: "count-a",
                status: "ready",
                total,
                bookRevision: 7,
                pageDirectory: { status: "ready", readyThrough: total },
              },
        };
      if (path.startsWith("/query-counts/count-a/page?")) {
        const params = new URL("https://fixture.test" + path).searchParams;
        const page = Number(params.get("page")),
          size = Number(params.get("limit"));
        const result = {
          pageNumber: page,
          totalPages: Math.max(1, Math.ceil(total / size)),
          items: Array.from(
            { length: Math.max(0, Math.min(size, total - (page - 1) * size)) },
            (_, i) => contact((page - 1) * size + i),
          ),
          bookRevision: 7,
          total,
          hasPrevious: page > 1,
          hasNext: page < Math.ceil(total / size),
          nextCursor: null,
          complete: page >= Math.ceil(total / size),
          effectiveSort: { field: "displayName", direction: "asc" },
        };
        return pageRead ? pageRead(result, options) : result;
      }
      throw new Error(`Unexpected request ${path}`);
    },
  };
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn) => {
    const timer = { fn, cancelled: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.cancelled = true;
  };
  let book;
  try {
    book = createOrganizationContactBook(runtime);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
  t.after(book.dispose);
  return {
    book,
    view,
    calls,
    failures,
    async poll() {
      const timer = timers.find((item) => !item.cancelled);
      assert.ok(timer, "A progress poll should be scheduled");
      timer.cancelled = true;
      timer.fn();
      await settle();
    },
  };
}

test("nearby page window shifts at both boundaries and remains constant size for millions of pages", () => {
  assert.deepEqual(contactPageWindow(1, 2001), [1, 2, 3, 4, 5]);
  assert.deepEqual(contactPageWindow(100, 2001), [98, 99, 100, 101, 102]);
  assert.deepEqual(
    contactPageWindow(2001, 2001),
    [1997, 1998, 1999, 2000, 2001],
  );
  assert.deepEqual(contactPageWindow(2, 3), [1, 2, 3]);
  assert.deepEqual(
    contactPageWindow(5000000, 9000000),
    [4999998, 4999999, 5000000, 5000001, 5000002],
  );
  assert.equal(
    contactDirectoryHasPage(
      { pageDirectory: { status: "building", readyThrough: 149 } },
      3,
      50,
    ),
    false,
  );
  assert.equal(
    contactDirectoryHasPage(
      { pageDirectory: { status: "building", readyThrough: 150 } },
      3,
      50,
    ),
    true,
  );
  assert.equal(
    contactDirectoryHasPage(
      { total: 153, pageDirectory: { status: "ready", readyThrough: 153 } },
      4,
      50,
    ),
    true,
  );
});

test("both controls jump straight to the last short page and preserve all selected contact intent", async (t) => {
  const h = fixture(t);
  await h.book.load();
  await settle();
  let html = h.book.render();
  assert.equal(
    (html.match(/aria-label="Contact pages (?:top|bottom)"/g) || []).length,
    2,
  );
  assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
  assert.match(html, /aria-label="First page" disabled>First/);
  assert.match(html, /aria-label="Previous page" disabled>Previous/);
  assert.equal(
    h.calls.find((call) => call.path === "/query-counts").body.pages,
    true,
  );
  await h.book.action("book-select-all");
  await h.book.action("book-last");
  assert.equal(h.view.contactBook.pageNumber, 2001);
  assert.equal(h.view.contactBook.rows.length, 3);
  assert.equal(h.view.contactBook.rows[0].contactId, "person-100000");
  assert.equal(h.calls.filter((call) => call.path === "/query").length, 1);
  assert.equal(
    h.calls.filter((call) => call.path.includes("/page?")).length,
    1,
  );
  html = h.book.render();
  assert.match(html, /Page 2,001 of 2,001/);
  assert.match(
    html,
    /aria-label="Page 2,001" aria-current="page" disabled>2,001/,
  );
  assert.match(html, /aria-label="Next page" disabled>Next/);
  assert.match(html, /aria-label="Last page" disabled>Last/);
  h.book.change({
    dataset: { contactChange: "book-row", contactId: "person-100002" },
    checked: false,
  });
  await h.book.action("book-previous");
  assert.equal(h.view.contactBook.pageNumber, 2000);
  await h.book.action("book-page", "100");
  assert.equal(h.view.contactBook.pageNumber, 100);
  assert.match(h.book.render(), /aria-label="Page 98"/);
  assert.match(h.book.render(), /aria-label="Page 102"/);
  await h.book.action("book-first");
  assert.equal(h.view.contactBook.rows[0].contactId, "person-0");
  assert.equal(h.view.contactBook.allMatching, true);
  assert.deepEqual(h.book.snapshot().spec.excludeIds, ["person-100002"]);
  assert.equal(h.book.snapshot().spec.expectedBookRevision, 7);
});

test("all supported page sizes use one direct page request and the correct final remainder", async (t) => {
  const h = fixture(t);
  await h.book.load();
  await settle();
  for (const size of [10, 25, 50, 100]) {
    h.book.change({
      dataset: { contactChange: "book-page-size" },
      value: String(size),
    });
    await h.book.action("book-page-size");
    await settle();
    await h.book.action("book-last");
    assert.equal(h.view.contactBook.pageNumber, Math.ceil(100003 / size));
    assert.equal(h.view.contactBook.rows.length, 3);
    assert.equal(h.view.contactBook.rows[0].contactId, "person-100000");
    assert.match(h.calls.at(-1).path, new RegExp(`limit=${size}$`));
  }
});

test("distant page waits without cursor walking and automatically opens when directory is ready", async (t) => {
  let ready = false;
  const h = fixture(t, {
    job: () => ({
      countId: "count-a",
      status: ready ? "ready" : "counting",
      total: 100003,
      bookRevision: 7,
      pageDirectory: {
        status: ready ? "ready" : "building",
        readyThrough: ready ? 100003 : 100,
      },
    }),
  });
  await h.book.load();
  await settle();
  await h.book.action("book-last");
  assert.equal(h.view.contactBook.pageNumber, 1);
  assert.equal(h.view.contactBook.rows.length, 50);
  assert.match(h.book.render(), /Preparing page 2,001/);
  assert.equal(
    h.calls.filter((call) => call.path.includes("/page?")).length,
    0,
  );
  ready = true;
  await h.poll();
  assert.equal(h.view.contactBook.pageNumber, 2001);
  assert.equal(h.view.contactBook.pendingPage, null);
  assert.equal(h.calls.filter((call) => call.path === "/query").length, 1);
  assert.equal(
    h.calls.filter((call) => call.path.includes("/page?")).length,
    1,
  );
});

test("page size and query changes cancel an obsolete jump and restart at page one", async (t) => {
  let release,
    hold = true;
  const h = fixture(t, {
    pageRead: (result, options) =>
      hold
        ? new Promise((resolve) => {
            release = () => resolve(result);
            assert.equal(options.signal.aborted, false);
          })
        : result,
  });
  await h.book.load();
  await settle();
  const old = h.book.action("book-last");
  await settle();
  const oldRequest = h.calls.at(-1);
  h.view.contactBook.query = {
    ...h.view.contactBook.query,
    search: "new filter",
  };
  await h.book.action("book-refresh");
  await settle();
  assert.equal(oldRequest.options.signal.aborted, true);
  release();
  await old;
  assert.equal(h.view.contactBook.pageNumber, 1);
  assert.equal(h.view.contactBook.rows[0].contactId, "person-0");
  assert.equal(h.view.contactBook.pendingPage, null);
  hold = false;
  await h.book.action("book-page", "3");
  assert.equal(h.view.contactBook.pageNumber, 3);
  h.book.change({ dataset: { contactChange: "book-page-size" }, value: "25" });
  await h.book.action("book-page-size");
  await settle();
  assert.equal(h.view.contactBook.pageNumber, 1);
  assert.equal(h.view.contactBook.rows.length, 25);
});

test("stale or denied direct pages do not replace the current rows or bypass access", async (t) => {
  let denied = false;
  const h = fixture(t, {
    pageRead: (result) => {
      if (denied) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return { ...result, bookRevision: 8 };
    },
  });
  await h.book.load();
  await settle();
  await h.book.action("book-page", "3");
  assert.equal(h.view.contactBook.pageNumber, 1);
  assert.match(h.view.contactBook.pageError, /Refresh contacts/);
  denied = true;
  await h.book.action("book-last");
  assert.equal(h.view.contactBook.rows.length, 0);
  assert.deepEqual(h.view.contactBook.schema.capabilities, {});
  assert.equal(h.failures.length, 1);
});

test("an empty book keeps one current page and disables both ends", async (t) => {
  const h = fixture(t, { total: 0 });
  await h.book.load();
  await settle();
  const html = h.book.render();
  assert.match(html, /Page 1 of 1/);
  assert.match(html, /aria-label="Next page" disabled>Next/);
  assert.match(html, /aria-label="Last page" disabled>Last/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
});

test("a pending next page clears if final counting finds no further contacts", async (t) => {
  let ready = false;
  const h = fixture(t, {
    total: 200,
    firstTotal: null,
    job: () => ({
      countId: "count-a",
      status: ready ? "ready" : "counting",
      total: ready ? 200 : null,
      bookRevision: 7,
      pageDirectory: {
        status: ready ? "ready" : "building",
        readyThrough: 200,
      },
    }),
    pageRead: (result) => ({ ...result, total: null, hasNext: true }),
  });
  await h.book.load();
  await settle();
  await h.book.action("book-page", "4");
  await h.book.action("book-more");
  assert.equal(h.view.contactBook.pendingPage, 5);
  ready = true;
  await h.poll();
  assert.equal(h.view.contactBook.pageNumber, 4);
  assert.equal(h.view.contactBook.pendingPage, null);
  assert.match(h.book.render(), /Page 4 of 4/);
  assert.match(h.book.render(), /aria-label="Next page" disabled>Next/);
});

test("the current or First page button cancels a waiting distant jump without another page read", async (t) => {
  let ready = false;
  const h = fixture(t, {
    job: () => ({
      countId: "count-a",
      status: ready ? "ready" : "counting",
      total: 100003,
      bookRevision: 7,
      pageDirectory: {
        status: ready ? "ready" : "building",
        readyThrough: 100,
      },
    }),
  });
  await h.book.load();
  await settle();
  await h.book.action("book-last");
  assert.match(h.book.render(), /aria-label="Page 1" aria-current="page">1/);
  assert.match(h.book.render(), /aria-label="First page">First/);
  await h.book.action("book-first");
  ready = true;
  await h.poll();
  assert.equal(h.view.contactBook.pageNumber, 1);
  assert.equal(h.view.contactBook.pendingPage, null);
  assert.equal(
    h.calls.filter((call) => call.path.includes("/page?")).length,
    0,
  );
});

test("page directory errors explain recovery without exposing internal codes", async () => {
  for (const code of [
    "contact_count_expired",
    "contact_count_not_found",
    "contact_page_not_ready",
    "contact_page_directory_required",
    "contact_page_directory_invalid",
    "contact_page_out_of_range",
    "contact_page_invalid",
  ]) {
    const api = createOrganizationContactsApi({
      scopeKey: "coalition:example",
      request: async () => {
        throw Object.assign(new Error(code), {
          status: 409,
          payload: { error: code },
        });
      },
    });
    await assert.rejects(
      api("/query-counts/count-a/page?page=2&limit=50"),
      (error) => {
        assert.match(error.message, /Refresh contacts/);
        assert.equal(error.message.includes(code), false);
        assert.equal(error.payload.error, code);
        return true;
      },
    );
  }
});
