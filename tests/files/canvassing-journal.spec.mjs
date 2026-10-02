import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { moduleUrl } from "../texting/module-fixture.mjs";
const { createOrganizationContactBook } = await import(
  await moduleUrl("organizationContactBook")
);
const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/canvassingJournalPresentation.js",
    import.meta.url,
  ),
);
const { canvassingJournalPresentation: present } = await import(
  `data:text/javascript;base64,${source.toString("base64")}`
);

test("journal keeps dated household evidence, exact signs and separate contact failure", () => {
  const view = present({
    recordedAt: "2026-09-01",
    round: { label: "Previous round" },
    place: { unitLabel: "A" },
    submissionId: "submission",
    canRetryContacts: true,
    contactProcessing: { status: "failed" },
    property: {
      outcome: "not_home",
      yardSigns: [{ name: "Historical name", party: "DEM" }],
      notSeenSigns: [{ name: "Other sign", party: "REP" }],
      contactResponse: "not_discussed",
      notes: "<script>unsafe</script>",
    },
  });
  assert.equal(view.canRetry, true);
  assert.ok(view.lines.includes("Round: Previous round"));
  assert.ok(view.lines.includes("Observed signs: Historical name · DEM"));
  assert.ok(view.lines.includes("Signs not seen: Other sign · REP"));
  assert.ok(
    view.lines.some((line) => line.includes("not personal statements")),
  );
  assert.ok(
    view.lines.some((line) => line.includes("saved visit remains available")),
  );
  assert.ok(view.lines.includes("Notes: <script>unsafe</script>")); // Caller must escape, not drop evidence.
});
test("retry is absent without permission or on ready entries; legacy labels stay unknown", () => {
  for (const value of [
    { status: "ready", can: true },
    { status: "failed", can: false },
  ])
    assert.equal(
      present({
        submissionId: "x",
        canRetryContacts: value.can,
        contactProcessing: { status: value.status },
      }).canRetry,
      false,
    );
  assert.ok(
    present({
      deleted: true,
      snapshotStatus: "legacy_identifiers_only",
      property: { yardSignCandidateIds: ["original-id"] },
    }).lines.includes("Observed signs: original-id"),
  );
});

test("shared contact details escape journal evidence and retry only the authorized failed visit", async () => {
  const calls = [],
    view = {};
  const book = createOrganizationContactBook({
    view: () => view,
    busy: () => false,
    guard() {},
    changed() {},
    contactApi: async (...args) => {
      calls.push(args);
      return { contactProcessing: { status: "pending" } };
    },
  });
  book.render();
  const state = view.contactBook;
  state.schema = {
    fields: [],
    tags: [],
    capabilities: { read: true, personal: true },
  };
  state.detail = {
    contact: { contactId: "contact-one", fields: { displayName: "Example" } },
  };
  state.activity = {
    kind: "journal",
    items: [
      {
        submissionId: "visit-one",
        canRetryContacts: true,
        contactProcessing: { status: "failed" },
        property: { notes: "<script>unsafe</script>" },
      },
    ],
  };
  const html = book.render();
  assert.match(html, /Address and unit journal/);
  assert.match(html, /Notes: &lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>unsafe<\/script>/);
  assert.match(html, /Retry Contact Book processing/);
  await assert.rejects(
    book.action("book-journal-contact-retry", "other-visit"),
    /authorized address journal/,
  );
  await book.action("book-journal-contact-retry", "visit-one");
  assert.deepEqual(calls, [["/canvassing-processing/visit-one/retry", {}]]);
  assert.equal(state.activity.items[0].contactProcessing.status, "pending");
  assert.doesNotMatch(book.render(), /Retry Contact Book processing/);
  state.activity.items[0].contactProcessing.status = "failed";
  state.schema.capabilities.personal = false;
  await assert.rejects(
    book.action("book-journal-contact-retry", "visit-one"),
    /authorized address journal/,
  );
  assert.equal(calls.length, 1);
  book.dispose();
});
