import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "../texting/module-fixture.mjs";
const { createOrganizationContactBook } = await import(
  await moduleUrl("organizationContactBook")
);
const { renderHouseholdContacts, householdOperation } = await import(
  await moduleUrl("organizationHouseholdContacts")
);

const household = {
  contactId: "private-household-id",
  recordKind: "household",
  revision: 2,
  status: "active",
  fields: {
    addressLine1: "100 Example Street",
    city: "Helena",
    state: "MT",
    postalCode: "59601",
  },
  tags: [],
};
const person = {
  contactId: "private-person-id",
  revision: 1,
  status: "active",
  fields: { ...household.fields, displayName: "Alex Example" },
  tags: [],
};
function fixture({ lostResponse = false, editable = true } = {}) {
  const view = {},
    calls = [];
  let completed = false,
    responseLost = false;
  const schema = {
    fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
    tags: [],
    sources: [],
    capabilities: {
      read: true,
      edit: editable,
      personal: true,
      householdContacts: true,
    },
  };
  const relationships = (target) => ({
    enabled: true,
    complete: true,
    households: target.recordKind === "household" ? [] : [household],
    people: target.recordKind === "household" && completed ? [person] : [],
  });
  const book = createOrganizationContactBook({
    view: () => view,
    busy: () => false,
    changed() {},
    guard() {},
    toast() {},
    context: () => ({ resourceId: "new" }),
    contactApi: async (path, body, method) => {
      calls.push({ path, body, method });
      if (path === "/schema") return schema;
      if (path === "/query")
        return {
          items: completed
            ? body.includeLinkedHouseholds
              ? [household, person]
              : [person]
            : [household],
          complete: true,
          total: completed && body.includeLinkedHouseholds ? 2 : 1,
          bookRevision: 2,
        };
      if (path.endsWith("/household-completion")) {
        completed = true;
        if (lostResponse && !responseLost) {
          responseLost = true;
          throw new Error("Response lost");
        }
        return {
          contact: person,
          household,
          relationships: relationships(person),
        };
      }
      if (path.includes("/activity?"))
        return {
          kind: "journal",
          items: [],
          nextCursor: path.includes("cursor=") ? null : "next",
        };
      if (path.startsWith("/contacts/")) {
        const target = path.includes(person.contactId) ? person : household;
        return { contact: target, relationships: relationships(target) };
      }
      return { items: [] };
    },
  });
  book.render();
  const state = view.contactBook;
  state.schema = schema;
  state.rows = [household];
  state.detail = {
    contact: household,
    relationships: relationships(household),
  };
  return { book, state, calls };
}

test("household completion uses recognizable names and keeps multiple people separate", () => {
  const html = renderHouseholdContacts({
    contact: household,
    relationships: {
      enabled: true,
      people: [
        person,
        {
          ...person,
          contactId: "second-person",
          fields: { displayName: "Jordan Example <Two>" },
        },
      ],
    },
    canEdit: true,
    button: (action, title) => `<button>${title}</button>`,
    formName: (name) => name,
  });
  assert.match(html, /Alex Example/);
  assert.match(html, /Jordan Example &lt;Two&gt;/);
  assert.match(html, /Property observations stay with the household/);
  assert.match(html, /Person&#39;s name/);
  assert.doesNotMatch(
    html,
    /<input[^>]*name="(?:contactId|userId|householdId)"/,
  );
  assert.doesNotMatch(html, />private-person-id</);
});

test("read-only household detail has no completion or linking controls", () => {
  const f = fixture({ editable: false });
  const html = f.book.render();
  assert.doesNotMatch(html, /Save contact details|Link an existing person/);
  f.book.dispose();
});

test("lost completion response retries the same operation, opens the named contact and refreshes the unified directory", async (t) => {
  const f = fixture({ lostResponse: true });
  const form = new FormData();
  form.set("displayName", "Alex Example");
  form.set("phone", "2025550100");
  t.mock.method(globalThis, "FormData", function (value) {
    return value;
  });
  await assert.rejects(
    f.book.submit("book-household-complete", form),
    /Response lost/,
  );
  await f.book.submit("book-household-complete", form);
  const submissions = f.calls.filter((call) =>
    call.path.endsWith("/household-completion"),
  );
  assert.equal(submissions.length, 2);
  assert.equal(
    submissions[0].body.operationId,
    submissions[1].body.operationId,
  );
  assert.deepEqual(submissions[0].body.fields, {
    displayName: "Alex Example",
    phone: "2025550100",
  });
  assert.equal(f.state.detail.contact.contactId, person.contactId);
  assert.deepEqual(
    f.state.rows.map((row) => row.contactId),
    [person.contactId],
  );
  assert.match(f.book.render(), /Household and property history/);
  f.book.dispose();
});

test("household journal pagination uses the address anchor while named contact details stay open", async () => {
  const f = fixture();
  f.state.detail = {
    contact: person,
    relationships: { enabled: true, households: [household], people: [] },
  };
  await f.book.action("book-household-journal", household.contactId);
  await f.book.action("book-activity-more", "journal");
  const requests = f.calls.filter((call) => call.path.includes("/activity?"));
  assert.equal(requests.length, 2);
  assert(
    requests.every((call) =>
      call.path.includes(`/contacts/${household.contactId}/activity`),
    ),
  );
  assert.equal(f.state.detail.contact.contactId, person.contactId);
  f.book.dispose();
});

test("completed household view is a server query option rather than client-only row filtering", async () => {
  const f = fixture();
  await f.book.action("book-household-view");
  assert.equal(
    f.calls.find((call) => call.path === "/query").body.includeLinkedHouseholds,
    true,
  );
  assert.equal(f.state.query.includeLinkedHouseholds, true);
  f.book.dispose();
});

test("changed completion inputs use a new operation; an unchanged retry retains its operation", () => {
  const state = {};
  let sequence = 0;
  const makeId = () => `operation-${++sequence}`;
  assert.equal(
    householdOperation(state, { displayName: "Alex" }, makeId),
    "operation-1",
  );
  assert.equal(
    householdOperation(state, { displayName: "Alex" }, makeId),
    "operation-1",
  );
  assert.equal(
    householdOperation(state, { displayName: "Jordan" }, makeId),
    "operation-2",
  );
});
