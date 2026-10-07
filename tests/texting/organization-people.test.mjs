import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

globalThis.document ||= { addEventListener() {} };
const { createOrganizationPeoplePage } = await import(
  await moduleUrl("organizationPeople")
);
const { createOrganizationPersonSearch } = await import(
  await moduleUrl("organizationPersonSearch")
);

test("person search fences stale requests, normalizes handles and paginates without duplicate identities", async () => {
  let actor = "one";
  const calls = [];
  const search = createOrganizationPersonSearch({
    identity: () => actor,
    changed() {},
    request: (path) => new Promise((resolve) => calls.push({ path, resolve })),
  });
  const old = search.search("@Alex");
  const latest = search.search("Sam");
  assert.match(calls[0].path, /q=Alex/);
  calls[1].resolve({
    items: [{ id: "p-1", displayName: "Sam", username: "sam" }],
    nextCursor: "next",
  });
  await latest;
  calls[0].resolve({ items: [{ id: "p-old", displayName: "Alex" }] });
  await old;
  assert.deepEqual(
    search.state.people.map((p) => p.userId),
    ["p-1"],
  );
  const more = search.search("Sam", { more: true });
  assert.match(calls[2].path, /cursor=next/);
  calls[2].resolve({
    items: [
      { id: "p-1", displayName: "Sam" },
      { id: "p-2", displayName: "Samantha" },
    ],
  });
  await more;
  assert.equal(search.state.people.length, 2);
  const switched = search.search("Taylor");
  actor = "two";
  calls[3].resolve({ items: [{ id: "for-old-actor", displayName: "Taylor" }] });
  await switched;
  assert.equal(search.state.people.length, 0);
});

test("independent People navigation checks Contact Book capability without texting registration", async () => {
  const paths = [];
  const page = createOrganizationPeoplePage({
    request: async (path) => {
      paths.push(path);
      return { capabilities: { read: true } };
    },
    context: () => ({
      scopeType: "candidate",
      scopeId: "campaign-one",
      userId: "actor",
      section: "people",
    }),
    changed() {},
    navigate() {},
    confirm: async () => true,
  });
  await page.load();
  assert.match(page.render(), /Organization contacts/);
  assert.deepEqual(paths, [
    "/api/contact-book/scopes/candidate%3Acampaign-one/schema",
  ]);
  page.reset();
});

test("coalition role review uses organization revision and preserves custom defaults through adoption and undo", async () => {
  const writes = [];
  let revision = 42;
  let permissions = ["missions_view"];
  const page = createOrganizationPeoplePage({
    request: async (path, options) => {
      if (options.method === "PATCH") {
        assert.equal(
          path,
          "/api/coalitions/org-one/access/roles/field-organizer",
        );
        assert.equal(options.body.expectedRevision, revision);
        assert.deepEqual(options.body.expectedPresetPermissions, permissions);
        writes.push(options.body);
        permissions = options.body.defaultPermissions;
        revision++;
        return { ok: true };
      }
      assert.equal(path, "/api/coalitions/org-one/access/catalog");
      return {
        revision,
        canManage: true,
        catalog: {
          authoritative: true,
          mutationRevision: 0,
          permissions: [{ key: "contact_book_view", label: "View contacts" }],
          roles: [
            {
              roleKey: "field-organizer",
              label: "Field Organizer",
              presetVersion: "coalition-v6",
              defaultPermissions: permissions,
              presetUpdate: {
                version: "2026-10-06",
                permissions: ["missions_view", "contact_book_view"],
                sensitivePermissions: [],
                reason: "Outreach contact access",
              },
            },
            {
              roleKey: "custom-role",
              label: "Our custom role",
              custom: true,
              defaultPermissions: ["missions_view"],
            },
          ],
        },
      };
    },
    context: () => ({
      scopeType: "coalition",
      scopeId: "org-one",
      userId: "actor",
      section: "roles",
    }),
    changed() {},
    navigate() {},
    confirm: async () => true,
  });
  await page.load();
  assert.match(page.render(), /View contacts/);
  assert.doesNotMatch(page.render(), /Our custom role/);
  await page.action("preset-apply", "field-organizer");
  assert.deepEqual(permissions, ["missions_view", "contact_book_view"]);
  await page.action("preset-undo", "field-organizer");
  assert.deepEqual(permissions, ["missions_view"]);
  assert.equal(writes.length, 2);
  page.reset();
});

test("organization audiences resolve names, use PUT membership and paginate members", async () => {
  const members = [
    { userId: "old-id", displayName: "Old Member", username: "old" },
  ];
  const writes = [];
  const page = createOrganizationPeoplePage({
    request: async (path, options) => {
      if (path.startsWith("/api/search/"))
        return {
          items: [{ id: "new-id", displayName: "New Member", username: "new" }],
        };
      if (options.method === "PUT") {
        writes.push(path);
        members.push({ userId: "new-id", displayName: "New Member" });
        return { ok: true };
      }
      if (path.endsWith("/audience-groups"))
        return {
          groups: [
            { groupId: "group-one", name: "Field volunteers", memberCount: 1 },
          ],
        };
      return {
        group: { groupId: "group-one", name: "Field volunteers" },
        members,
        nextCursor: null,
      };
    },
    context: () => ({
      scopeType: "coalition",
      scopeId: "org-one",
      userId: "actor",
      section: "audiences",
    }),
    changed() {},
    navigate() {},
    confirm: async () => true,
  });
  await page.load();
  await page.action("audience-open", "group-one");
  assert.match(page.render(), /Old Member/);
  await page.search.search("New");
  await page.action("audience-add", "new-id");
  assert.deepEqual(writes, [
    "/api/organizations/coalition/org-one/audience-groups/group-one/members/new-id",
  ]);
  assert.match(page.render(), /New Member/);
  assert.doesNotMatch(page.render(), /User ID/);
  page.reset();
});
