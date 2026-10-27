import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/coalitionAdministrationModel.js",
    import.meta.url,
  ),
  "utf8",
);
const model = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const profile = (changes = {}) => ({
  name: "Cedar Valley Coalition",
  coalitionType: "simple",
  description: "Neighbors working together.",
  imageUrl: "https://images.example.test/logo.png",
  primaryContactName: "Jordan Lee",
  phone: "(406) 555-0144",
  email: "hello@example.test",
  website: "https://example.test",
  pacAssociated: false,
  fecNumber: "",
  facebook: "",
  threads: "",
  bluesky: "",
  instagram: "",
  tiktok: "",
  ...changes,
});

test("profile writes require all six organization identity/contact fields", () => {
  for (const key of [
    "imageUrl",
    "name",
    "description",
    "primaryContactName",
    "phone",
    "email",
  ]) {
    const candidate = profile({ [key]: " " });
    assert.ok(model.adminProfileErrors(candidate)[key], key);
    assert.throws(() => model.adminProfilePayload(candidate));
  }
});

test("URL validation rejects executable schemes and embedded credentials", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "file:///private.png",
    "https://alice:example-password@example.test/logo.png",
    "not a URL",
  ]) {
    assert.equal(model.adminUrl(value), "", value);
    assert.ok(model.adminProfileErrors(profile({ imageUrl: value })).imageUrl);
  }
  assert.equal(
    model.adminUrl(" https://example.test/a.png "),
    "https://example.test/a.png",
  );
  assert.equal(
    model.adminUrl("http://example.test/a.png"),
    "http://example.test/a.png",
  );
});

test("optional public URLs validate independently and cannot become active markup", () => {
  for (const key of [
    "website",
    "facebook",
    "threads",
    "bluesky",
    "instagram",
    "tiktok",
  ]) {
    assert.ok(
      model.adminProfileErrors(
        profile({ [key]: "https://name:password@example.test" }),
      )[key],
    );
    assert.equal(
      model.adminProfileErrors(
        profile({ [key]: "https://example.test/profile" }),
      )[key],
      undefined,
    );
  }
  assert.equal(
    model.adminEscape('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

test("PAC association requires a recorded FEC value without inventing verification", () => {
  assert.ok(
    model.adminProfileErrors(profile({ pacAssociated: true })).fecNumber,
  );
  const body = model.adminProfilePayload(
    profile({ pacAssociated: true, fecNumber: " C00012345 " }),
  );
  assert.equal(body.pacAssociated, true);
  assert.equal(body.fecNumber, "C00012345");
  assert.equal("verified" in body, false);
  assert.equal("verificationStatus" in body, false);
  assert.equal(
    model.adminProfilePayload(
      profile({ pacAssociated: false, fecNumber: "old-value" }),
    ).fecNumber,
    "",
  );
});

test("profile payload explicitly clears optional links instead of silently retaining old values", () => {
  const original = profile({
    website: "",
    facebook: "",
    threads: "",
    bluesky: "",
    instagram: "",
    tiktok: "",
  });
  const body = model.adminProfilePayload(original);
  assert.equal(body.website, null);
  assert.equal(body.socials, null);
  assert.equal(body.pacAssociated, false);
  assert.equal(original.website, "");
  const linked = model.adminProfilePayload(
    profile({
      facebook: " https://example.test/fb ",
      tiktok: "https://example.test/tiktok",
    }),
  );
  assert.deepEqual(linked.socials, {
    facebook: "https://example.test/fb",
    tiktok: "https://example.test/tiktok",
  });
});

test("only supported organization types enter the write payload", () => {
  for (const coalitionType of ["simple", "constitutional"])
    assert.equal(
      model.adminProfilePayload(profile({ coalitionType })).coalitionType,
      coalitionType,
    );
  assert.throws(() =>
    model.adminProfilePayload(profile({ coalitionType: "invented" })),
  );
});

test("active membership and explicit capabilities govern every administrative surface", () => {
  const enabled = { voterMapEnabled: true };
  for (const status of ["pending", "inactive", "removed", ""]) {
    assert.deepEqual(
      model.adminPermissions(
        { roleKey: "admin", status, permissions: ["profile_manage"] },
        enabled,
      ),
      {
        active: false,
        admin: false,
        profile: false,
        view: false,
        scriptsView: false,
        scripts: false,
      },
    );
  }
  const editor = model.adminPermissions(
    {
      roleKey: "profile_editor",
      status: "active",
      permissions: ["profile_manage", "voter_map_access"],
    },
    enabled,
  );
  assert.equal(editor.view, true);
  assert.equal(editor.profile, true);
  assert.equal(editor.scriptsView, true);
  assert.equal(editor.scripts, false);
  const leader = model.adminPermissions(
    {
      roleKey: "staff_lead",
      status: "active",
      permissions: ["members_manage"],
    },
    enabled,
  );
  assert.equal(leader.view, true);
  assert.equal(leader.profile, false);
  assert.equal(leader.scripts, false);
  const forged = model.adminPermissions(
    { roleKey: "member", status: "active", isAdmin: true, permissions: [] },
    enabled,
  );
  assert.equal(forged.profile, false);
  assert.equal(forged.view, false);
});

test("legacy officer alias retains real backend administrator access but disabled Field Work stays disabled", () => {
  for (const roleKey of ["admin", "officer"]) {
    const rights = model.adminPermissions(
      { roleKey, status: "active", permissions: [] },
      { voterMapEnabled: true },
    );
    assert.equal(rights.profile, true);
    assert.equal(rights.scripts, true);
    assert.equal(
      model.adminPermissions(
        { roleKey, status: "active" },
        { voterMapEnabled: false },
      ).scripts,
      false,
    );
  }
});

test("all four outreach channels survive partial drafts and ignore unsupported data keys", () => {
  const normalized = model.adminScripts({
    templates: {
      phoneCall: { title: "Draft title", body: "" },
      textMessage: { title: "", body: "Draft body" },
      unexpected: { title: "Ignore", body: "Ignore" },
    },
  });
  assert.deepEqual(Object.keys(normalized), [
    "phoneCall",
    "textMessage",
    "mailEmail",
    "mailPhysical",
  ]);
  assert.deepEqual(normalized.phoneCall, { title: "Draft title", body: "" });
  assert.deepEqual(normalized.textMessage, { title: "", body: "Draft body" });
  assert.deepEqual(normalized.mailPhysical, { title: "", body: "" });
  assert.deepEqual(model.adminScriptsPayload(normalized).templates, normalized);
  assert.deepEqual(
    model.adminChannels.find((row) => row.key === "mailPhysical").tokens,
    ["firstName", "campaignName"],
  );
});

test("outreach title/body limits are enforced before a write rather than silently truncating", () => {
  const normalized = model.adminScripts();
  normalized.phoneCall = { title: "x".repeat(120), body: "y".repeat(5000) };
  assert.equal(
    model.adminScriptsPayload(normalized).templates.phoneCall.body.length,
    5000,
  );
  assert.throws(() =>
    model.adminScriptsPayload({
      ...normalized,
      phoneCall: { title: "x".repeat(121), body: "" },
    }),
  );
  assert.throws(() =>
    model.adminScriptsPayload({
      ...normalized,
      phoneCall: { title: "", body: "y".repeat(5001) },
    }),
  );
});

test("missing or invalid revisions remain unknown instead of becoming a fabricated zero", () => {
  for (const input of [
    {},
    { revision: null },
    { revision: "bad" },
    { revision: -1 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.equal(model.adminRevision(input), null);
  assert.equal(model.adminRevision({ revision: 0 }), 0);
  assert.equal(model.adminRevision({ revision: "12" }), 12);
  assert.equal(
    model.adminRevision({ coalition: { organizationMutationRevision: 8 } }),
    8,
  );
});

test("image upload sessions need an HTTPS upload endpoint and a complete delivery URL", () => {
  const valid = {
    uid: "fixture-image",
    uploadURL: "https://upload.imagedelivery.net/fixture",
    deliveryUrl: "https://imagedelivery.net/fixture/public",
    fields: { metadata: "example" },
    fileFieldName: "file",
  };
  assert.deepEqual(model.adminUpload(valid), {
    uid: valid.uid,
    uploadUrl: valid.uploadURL,
    deliveryUrl: valid.deliveryUrl,
    fields: valid.fields,
    fileFieldName: "file",
  });
  for (const invalid of [
    { ...valid, uid: "" },
    { ...valid, uploadURL: "http://upload.example.test" },
    { ...valid, deliveryUrl: "" },
    { ...valid, uploadURL: "https://user:password@upload.example.test" },
  ])
    assert.throws(() => model.adminUpload(invalid));
});
