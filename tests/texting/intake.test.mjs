import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const source = (
  await readFile(
    new URL(
      "../../frontend/src/pages/shared-feed/scripts/textingIntake.js",
      import.meta.url,
    ),
    "utf8",
  )
)
  .replace(/^import .*;\r?\n/gm, "")
  .replace(
    "export const WEBSITE_GUIDELINES_VERSION",
    'const guidelinesUrl = "/guidelines.pdf";\nexport const WEBSITE_GUIDELINES_VERSION',
  );
const {
  validateTextingIntake,
  decodeTextingIntake,
  createTextingIntakePage,
  intakeStepForField,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const fields = {
  firstName: "Alex",
  lastName: "Morgan",
  email: "alex@example.org",
  phone: "2025550100",
  legalEntityName: "Civic Action Team",
  dba: "",
  country: "US",
  taxEin: "00-0000000",
  entityStreetAddress: "123 Example Street",
  entityCity: "Sampletown",
  entityState: "CT",
  entityZip: "06000",
  websiteAddress: "https://example.org",
  legalEntityType: "political",
  filingUrl: "https://example.org/filing",
  filingInstructions: "",
  useCaseDescription: "Community updates",
  sampleMessage1:
    "Civic Action Team: https://example.org. Reply STOP to opt out.",
  sampleMessage2:
    "Civic Action Team meeting: https://example.org. Reply STOP to opt out.",
  sampleMessage3: "",
  areaCode1: "202",
  areaCode2: "",
  listSource: "Authorized voter file",
  permittedPurpose: "Permitted political outreach",
};
const validOptions = {
  authority: true,
  token: "test-token-not-real",
  expiresOn: "2099-12-31",
};
const savedVerify = {
  hasToken: true,
  expiresOn: "2099-12-31",
  lastOperationId: "8e13fa4a-2a85-4e40-8f13-d00a1c31c7ad",
  status: "not_submitted",
};
function response(overrides = {}) {
  return {
    ok: true,
    guidelinesVersion: "polis-10dlc-website-2026-09-17",
    intake: {
      intakeId: "registration",
      revision: 1,
      status: "ready_for_handoff",
      packet: { version: 1, ...fields, authorityConfirmed: true },
      campaignVerify: savedVerify,
      canSend: false,
      manualOnly: true,
      ...overrides,
    },
  };
}
function harness(request) {
  const listeners = {};
  globalThis.document = {
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    querySelector: () => null,
  };
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const stored = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => stored.get(key),
    setItem: (key, value) => stored.set(key, value),
  };
  let identity = {
    organizationId: "org-one",
    userId: "admin-one",
    section: "registration",
  };
  const navigation = [];
  const module = createTextingIntakePage({
    request,
    context: () => identity,
    changed: () => {},
    navigate: (page) => navigation.push(page),
  });
  const key = () => `${identity.userId}:${identity.organizationId}`;
  const root = () => ({ dataset: { intakeRoot: key() } });
  const click = async (action) => {
    const target = {
      dataset: { intakeAction: action },
      closest: (selector) =>
        selector === "[data-intake-action]" ? target : root(),
    };
    listeners.click({ target, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const edit = (name, value) =>
    listeners.input({
      type: "input",
      target: {
        dataset: { intakeField: name },
        value,
        checked: value === true,
        closest: () => root(),
      },
    });
  return {
    module,
    click,
    edit,
    navigation,
    setIdentity: (next) => {
      identity = next;
    },
  };
}

test("all required fields, full CV token and actual future date are validated", () => {
  assert.deepEqual(validateTextingIntake(fields, validOptions), {});
  for (const name of [
    "email",
    "phone",
    "legalEntityName",
    "taxEin",
    "entityStreetAddress",
    "entityCity",
    "entityState",
    "entityZip",
    "websiteAddress",
    "filingUrl",
    "useCaseDescription",
    "sampleMessage1",
    "sampleMessage2",
    "areaCode1",
    "listSource",
    "permittedPurpose",
  ])
    assert.ok(
      validateTextingIntake({ ...fields, [name]: "" }, validOptions)[name],
      name,
    );
  assert.ok(
    validateTextingIntake(fields, { ...validOptions, token: "" })[
      "campaignVerify.token"
    ],
  );
  for (const expiry of ["2020-01-01", "2099-02-30", "2099-2-1"])
    assert.ok(
      validateTextingIntake(fields, { ...validOptions, expiresOn: expiry })[
        "campaignVerify.expiresOn"
      ],
    );
  assert.ok(
    validateTextingIntake(
      { ...fields, sampleMessage2: "No opt out" },
      validOptions,
    ).sampleMessage2,
  );
  assert.equal(intakeStepForField("campaignVerify.expiresOn"), 1);
});

test("saved CV token remains valid without readback; expiry changes require replacement token", () => {
  assert.deepEqual(
    validateTextingIntake(fields, {
      authority: true,
      token: "",
      expiresOn: savedVerify.expiresOn,
      savedVerify,
    }),
    {},
  );
  assert.ok(
    validateTextingIntake(fields, {
      authority: true,
      token: "",
      expiresOn: "2099-11-30",
      savedVerify,
    })["campaignVerify.token"],
  );
  assert.throws(() =>
    decodeTextingIntake(
      response({
        campaignVerify: { ...savedVerify, token: "must-never-be-read-back" },
      }),
    ),
  );
  assert.throws(() => decodeTextingIntake(response({ canSend: true })));
});

test("incomplete steps cannot advance; form has no provider branding or initial not-submitted bubble", async () => {
  const h = harness(async () => ({ ok: true, intake: null }));
  await h.module.load();
  await h.click("start");
  await h.click("next");
  const rendered = h.module.render();
  assert.match(rendered, /STEP 1 OF 4/);
  assert.match(rendered, /data-intake-action="next" disabled/);
  assert.doesNotMatch(rendered, /Prompt\.io|Client intake not submitted/);
});

test("submission requires website acknowledgment and persists an explicit vendor-handoff packet", async () => {
  const calls = [];
  const h = harness(async (path, options) => {
    calls.push({ path, options });
    if (options.method === "PUT")
      return response({
        revision: 2,
        packet: { ...options.body.packet, campaignVerify: undefined },
      });
    if (options.method === "POST")
      return response({ revision: 3, status: "submitted" });
    return response();
  });
  await h.module.load();
  await h.click("next");
  await h.click("next");
  await h.click("next");
  await h.click("review");
  assert.match(h.module.render(), /STOP — Is your website ready/);
  await h.click("submit");
  assert.equal(
    calls.filter((call) => call.options.method === "POST").length,
    0,
  );
  h.edit("websiteConfirmed", true);
  await h.click("submit");
  const submission = calls.find((call) => call.options.method === "POST");
  assert.ok(submission);
  assert.match(submission.path, /coalition%3Aorg-one\/submit$/);
  assert.deepEqual(submission.options.body.websiteAcknowledgment, {
    version: "polis-10dlc-website-2026-09-17",
    confirmed: true,
  });
  assert.match(h.module.render(), /You’re in review/);
  assert.doesNotMatch(h.module.render(), /test-token-not-real/);
});

test("failed save prevents repeated writes until the saved state is checked", async () => {
  let puts = 0;
  const h = harness(async (_path, options) => {
    if (options.method === "PUT") {
      puts++;
      throw new Error("uncertain");
    }
    return response();
  });
  await h.module.load();
  h.edit("firstName", "Updated");
  await h.click("save");
  await h.click("save");
  assert.equal(puts, 1);
  assert.match(h.module.render(), /Check saved copy/);
  await h.click("check-saved");
  assert.match(h.module.render(), /saved copy differs/);
  assert.match(h.module.render(), /Updated/);
  await h.click("load-saved");
  assert.match(h.module.render(), /value="Alex"/);
});

test("submit saves complete edits once and confirms the saved revision before handoff", async () => {
  const calls = [];
  const h = harness(async (_path, options) => {
    calls.push(options);
    if (options.method === "PUT") {
      const { campaignVerify: command, ...savedPacket } = options.body.packet;
      return response({
        revision: 2,
        packet: savedPacket,
        campaignVerify: command
          ? {
              hasToken: true,
              expiresOn: command.expiresOn,
              lastOperationId: command.operationId,
            }
          : savedVerify,
      });
    }
    if (options.method === "POST")
      return response({ revision: 3, status: "submitted" });
    return response();
  });
  await h.module.load();
  h.edit("firstName", "Updated");
  h.edit("campaignVerify.token", "replacement-secret-not-real");
  for (let step = 0; step < 3; step += 1) await h.click("next");
  await h.click("review");
  h.edit("websiteConfirmed", true);
  await h.click("submit");
  assert.deepEqual(
    calls.map((call) => call.method || "GET"),
    ["GET", "PUT", "POST"],
  );
  assert.equal(calls[1].body.expectedRevision, 1);
  assert.equal(calls[1].body.packet.campaignVerify.action, "replace");
  assert.equal(calls[2].body.expectedRevision, 2);
  assert.match(h.module.render(), /You’re in review/);
  assert.doesNotMatch(h.module.render(), /replacement-secret-not-real/);
});

test("organization change ignores delayed results and reset clears registration data", async () => {
  let finish;
  const h = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = h.module.load();
  h.setIdentity({
    organizationId: "org-two",
    userId: "admin-one",
    section: "registration",
  });
  finish(response());
  await loading;
  assert.doesNotMatch(h.module.render(), /Civic Action Team|Alex|00-0000000/);
  h.module.reset();
  assert.deepEqual(h.module.getMeta(), {});
});

test("saved approved details are escaped and cannot be edited or self-activate texting", async () => {
  const h = harness(async () =>
    response({
      status: "approved",
      reviewMessage: "<script>bad()</script> Prompt.io reviewed this.",
    }),
  );
  await h.module.load();
  assert.match(h.module.render(), /Service activation is a separate step/);
  assert.match(h.module.render(), /&lt;script&gt;/);
  assert.doesNotMatch(
    h.module.render(),
    /Prompt\.io|<script>|data-intake-action="save"/,
  );
  h.setIdentity({
    organizationId: "org-one",
    userId: "admin-one",
    section: "settings",
  });
  assert.match(h.module.render(), /Token stored securely/);
  assert.doesNotMatch(h.module.render(), /test-token-not-real/);
});
