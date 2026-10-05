import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "../texting/module-fixture.mjs";
const { createOrganizationContactBook } = await import(
  await moduleUrl("organizationContactBook")
);
const { isHouseholdContact, contactDisplayName, householdAddressStatus } =
  await import(await moduleUrl("organizationContactsModel"));

const household = () => ({
  contactId: "household-one",
  recordKind: "household",
  revision: 3,
  status: "active",
  fields: {
    addressLabel: "42 Example Lane <West>",
    addressResolution: { status: "unverified" },
  },
  tags: ["legacy-tag"],
  sources: [{ sourceId: "door", sourceRecordId: "location-one" }],
});
const schema = {
  fields: [
    { fieldId: "displayName", label: "Name", group: "Identity", type: "text" },
    { fieldId: "phone", label: "Phone", group: "Contact", type: "phone" },
    {
      fieldId: "addressLabel",
      label: "Address label",
      group: "Address",
      type: "text",
      readOnly: true,
    },
    {
      fieldId: "consentStatus",
      label: "Opt-in status",
      group: "Consent",
      type: "text",
    },
  ],
  tags: [{ tagId: "visited", label: "Visited" }],
  sources: [{ sourceId: "door", label: "DoorKnocker" }],
  capabilities: {
    read: true,
    edit: true,
    tag: true,
    select: true,
    personal: true,
    manage: true,
    campaign: true,
  },
};
function fixture(mode = "book", contact = household()) {
  const view = {},
    calls = [];
  const book = createOrganizationContactBook(
    {
      view: () => view,
      busy: () => false,
      changed() {},
      guard() {},
      toast() {},
      context: () => ({ resourceId: "new" }),
      contactApi: async (path, body, method) => {
        calls.push({ path, body, method });
        if (path === "/schema") return structuredClone(schema);
        if (path === "/query")
          return {
            items: [contact],
            complete: true,
            bookRevision: 1,
            total: 1,
          };
        if (path.startsWith("/contacts/"))
          return { contact: { ...contact, ...body } };
        return { items: [] };
      },
    },
    { mode },
  );
  book.render();
  const state = view[mode === "selector" ? "recipientBook" : "contactBook"];
  state.schema = structuredClone(schema);
  state.rows = [contact];
  return { book, state, calls, contact };
}

test("household titles use address facts and labels without creating a resident identity", () => {
  const contact = household(),
    before = structuredClone(contact);
  assert.equal(isHouseholdContact(contact), true);
  assert.equal(contactDisplayName(contact), "42 Example Lane <West>");
  assert.equal(householdAddressStatus(contact), "Address not yet verified");
  assert.deepEqual(contact, before);
  assert.equal(
    contactDisplayName({ recordKind: "household", fields: {} }),
    "Household",
  );
  assert.equal(
    contactDisplayName({
      recordKind: "household",
      fields: {
        displayName: "Old name",
        addressLine1: "8 Sample St",
        addressLine2: "Unit 2",
        city: "Example",
        state: "MT",
        postalCode: "00042",
      },
    }),
    "8 Sample St, Unit 2, Example, MT, 00042",
  );
  assert.equal(
    householdAddressStatus({
      fields: { addressResolution: { status: "verified" } },
    }),
    "Verified address",
  );
  assert.equal(
    householdAddressStatus({
      fields: { addressResolution: { status: "missing" } },
    }),
    "Address not yet verified",
  );
  assert.equal(
    isHouseholdContact({ fields: { recordKind: "household" } }),
    false,
  );
  assert.equal(
    contactDisplayName({ fields: { displayName: "Alex Example" } }),
    "Alex Example",
  );
});

test("household rows expose kind and address status and never claim texting eligibility", () => {
  const f = fixture();
  f.contact.eligibility = { status: "eligible" };
  f.contact.fields.consentStatus = "opted_in";
  f.state.columns.push("consentStatus");
  const html = f.book.render();
  assert.match(html, /42 Example Lane &lt;West&gt;/);
  assert.match(html, /Household · Address not yet verified/);
  assert.match(html, /Not a texting recipient/);
  assert.doesNotMatch(
    html.match(/<tbody>[\s\S]*?<\/tbody>/)[0],
    />Eligible<|>Opted in<|42 Example Lane <West>/,
  );
  f.book.dispose();
});

test("household detail keeps tags, archive and journal access while preventing identity or field edits", async () => {
  const f = fixture();
  f.state.detail = { contact: f.contact };
  f.contact.eligibility = { status: "eligible", reasons: [] };
  const html = f.book.render();
  assert.match(html, /Address-only household/);
  assert.match(html, /This household cannot receive texts/);
  assert.match(html, /Edit contact tags|Archive contact/);
  assert.match(html, /Address and unit journal/);
  assert.doesNotMatch(
    html,
    /name="contact_|Texting:|Update districts|Remove source membership|Review duplicate contacts/,
  );
  for (const action of [
    "book-enrich",
    "book-source-remove",
    "book-identity-choose",
    "book-identity-merge",
    "book-identity-split",
  ])
    await assert.rejects(f.book.action(action, "other"));
  assert.equal(f.calls.length, 0);
  f.book.dispose();
});

test("saving household tags omits fields even when the caller has edit permission", async (t) => {
  const f = fixture();
  f.state.detail = { contact: f.contact };
  const form = new FormData();
  form.append("tagId", "visited");
  form.append("contact_displayName", "Invented resident");
  form.append("contact_phone", "2025550100");
  t.mock.method(globalThis, "FormData", function (value) {
    return value;
  });
  await f.book.submit("book-contact", form);
  const saved = f.calls.find((call) => call.method === "PATCH");
  assert.deepEqual(saved.body.tags, ["visited", "legacy-tag"]);
  assert.equal(saved.body.expectedRevision, 3);
  assert.equal(Object.hasOwn(saved.body, "fields"), false);
  await f.book.action("book-contact-archive");
  const archived = f.calls.filter((call) => call.method === "PATCH").at(-1);
  assert.equal(archived.body.status, "archived");
  assert.equal(Object.hasOwn(archived.body, "fields"), false);
  f.book.dispose();
});

test("household endpoint choices stay unavailable even if an old response includes phone fields", () => {
  const f = fixture("selector");
  f.contact.fields.phone = "2025550100";
  f.contact.fields.phones = ["2025550100", "2025550101"];
  f.state.includeIds.add(f.contact.contactId);
  f.state.overlay = "selection";
  assert.doesNotMatch(
    f.book.render(),
    /Texting number for|recipients-endpoint/,
  );
  assert.throws(
    () =>
      f.book.change({
        dataset: {
          contactChange: "recipients-endpoint",
          contactId: f.contact.contactId,
        },
        value: "2025550100",
      }),
    /cannot receive texts/,
  );
  assert.deepEqual(f.state.endpointChoices, {});
  f.book.dispose();
});

test("person detail and tag saves retain existing editing and texting behavior", async (t) => {
  const contact = {
    contactId: "person-one",
    revision: 2,
    fields: { displayName: "Alex Example", phone: "2025550100" },
    eligibility: { status: "eligible" },
    tags: [],
  };
  const f = fixture("book", contact);
  f.state.detail = { contact };
  const html = f.book.render();
  assert.match(html, /name="contact_displayName"/);
  assert.match(
    html,
    /Update districts|Texting: Eligible|Review duplicate contacts/,
  );
  assert.doesNotMatch(html, /Address-only household|cannot receive texts/);
  const form = new FormData();
  form.append("contact_displayName", "Alex Updated");
  t.mock.method(globalThis, "FormData", function (value) {
    return value;
  });
  await f.book.submit("book-contact", form);
  assert.deepEqual(
    f.calls.find((call) => call.method === "PATCH").body.fields,
    { displayName: "Alex Updated" },
  );
  f.book.dispose();
});

test("household selections retain tags but hide incompatible bulk source and district edits", async () => {
  const f = fixture();
  f.state.includeIds.add(f.contact.contactId);
  f.state.overlay = "selection";
  const html = f.book.render();
  assert.match(html, /Apply tag/);
  assert.doesNotMatch(
    html,
    /Update districts for selection|Remove source from selection/,
  );
  await assert.rejects(
    f.book.action("book-geography-start"),
    /managed through DoorKnocker/,
  );
  assert.equal(f.calls.length, 0);
  f.book.dispose();
});

test("a household cannot become a merge candidate for a person", async () => {
  const f = fixture();
  f.state.detail = {
    contact: { contactId: "person-one", fields: { displayName: "Alex" } },
  };
  await assert.rejects(
    f.book.action("book-identity-choose", f.contact.contactId),
    /cannot be merged/,
  );
  assert.equal(f.state.mergeCandidate, undefined);
  assert.equal(
    f.calls.some((call) => call.path === "/identities/merge"),
    false,
  );
  f.book.dispose();
});
