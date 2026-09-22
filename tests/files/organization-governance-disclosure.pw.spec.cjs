const { test, expect } = require("@playwright/test");

const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const API = "/api/organizations/org-audit/governance/v2";
const CASE = `${API}/audit-cases/case-audit`;
const CASE_ROUTE = "/organizations/org-audit/governance/audit-cases/case-audit";

function token(userId) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: userId, name: "Audit reviewer" })}.fixture`;
}

function caseRecord(overrides = {}) {
  return {
    auditCaseId: "case-audit",
    organizationId: "org-audit",
    voteId: "vote-audit",
    manifestHash: "manifest-audit",
    privacyMode: "SEALED_AUDIT",
    status: "GRANT_ISSUED",
    version: 5,
    grantId: "grant-original",
    caseScopeHash: "scope-original",
    targetReceiptDigest: "receipt-digest-original",
    targetReceiptCode: "fictional-receipt",
    requestedByUserId: "requester",
    namedAuditorUserId: "auditor",
    reason: "Fictional audit acceptance",
    approvals: [
      { approverUserId: "guardian" },
      { approverUserId: "approver-two" },
    ],
    ...overrides,
  };
}

function delivery(auditCase, status = "PROCESSING", overrides = {}) {
  return {
    status,
    auditCaseId: auditCase.auditCaseId,
    grantId: auditCase.grantId,
    namedAuditorUserId: auditCase.namedAuditorUserId,
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function fixture(
  page,
  {
    userId = "guardian",
    permissions = ["vote_audit_approve"],
    record = caseRecord(),
    parent = {},
  } = {},
) {
  const world = { record, calls: [], pending: [], permissions, response: null };
  await page.addInitScript(
    ({ base, user }) => {
      const session = {
        accessToken: user.token,
        idToken: user.token,
        refreshToken: "fixture",
        expiresAt: Date.now() + 3600000,
      };
      localStorage.setItem(
        "sharedFeedSessionPersisted.v1",
        JSON.stringify(session),
      );
      sessionStorage.setItem("sharedFeedSession.v1", JSON.stringify(session));
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: base,
            auth: {
              ...value?.auth,
              region: "us-west-2",
              clientId: "test-client",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { base: BASE, user: { token: token(userId) } },
  );
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const send = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/profile/me")
      return send({ profile: { userId, displayName: "Audit reviewer" } });
    if (url.pathname === API)
      return send({
        policy: { version: 1 },
        viewer: { userId, permissions: world.permissions },
      });
    if (
      url.pathname === `${API}/votes` ||
      url.pathname === `${API}/votes/vote-audit`
    ) {
      const vote = {
        organizationId: "org-audit",
        voteId: "vote-audit",
        manifestHash: "manifest-audit",
        status: "PUBLISHED",
        version: 9,
        question: "Fictional published vote",
        rules: { privacyMode: record.privacyMode, ballotMethod: "YES_NO" },
        ...parent,
      };
      return send(
        url.pathname.endsWith("/votes") ? { items: [vote] } : { vote },
      );
    }
    if (url.pathname === CASE && request.method() === "GET")
      return send({ auditCase: world.record });
    if (url.pathname.startsWith(`${CASE}/`) && request.method() === "POST") {
      world.calls.push({ path: url.pathname, body: request.postDataJSON() });
      if (world.response) return world.response(route, send);
      return send({
        auditCase: world.record,
        delivery: delivery(world.record),
      });
    }
    return send({ items: [] });
  });
  await page.goto(BASE + CASE_ROUTE);
  await expect(
    page.getByRole("heading", { name: "Audit case", exact: true }),
  ).toBeVisible();
  return world;
}

for (const privacyMode of ["SEALED_AUDIT", "SECRET_ADMIN_AUDITABLE"]) {
  test(`${privacyMode}: resumes the original grant through processing and delivered responses`, async ({
    page,
  }) => {
    const world = await fixture(page, { record: caseRecord({ privacyMode }) });
    const resume = page.getByRole("button", {
      name: "Resume one-record disclosure",
    });
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect(
      page
        .getByText("Disclosure is still processing.", { exact: true })
        .first(),
    ).toBeVisible();
    await expect(resume).toBeEnabled();
    world.response = (_route, send) =>
      send({
        auditCase: world.record,
        delivery: delivery(world.record, "DELIVERED"),
      });
    await resume.click();
    await expect(
      page.getByText("One-record delivery is ready.", { exact: true }).first(),
    ).toBeVisible();
    expect(world.calls).toEqual(
      [1, 2].map(() => ({
        path: `${CASE}/disclose`,
        body: { expectedVersion: 5 },
      })),
    );
    await expect(
      page.getByRole("button", { name: "View disclosure", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Audit case disclosed.", { exact: true }),
    ).toHaveCount(0);
  });
}

test("initial issue transitions to resume with the returned version and same recipient", async ({
  page,
}) => {
  const world = await fixture(page, {
    record: caseRecord({ status: "AUTHORIZED", version: 4, grantId: "" }),
  });
  world.response = (_route, send) => {
    world.record = caseRecord();
    return send({ auditCase: world.record, delivery: delivery(world.record) });
  };
  await page
    .getByRole("button", { name: "Issue one-record disclosure" })
    .click();
  const resume = page.getByRole("button", {
    name: "Resume one-record disclosure",
  });
  await expect(resume).toBeEnabled();
  await resume.click();
  expect(world.calls.map((call) => call.body)).toEqual([
    { expectedVersion: 4 },
    { expectedVersion: 5 },
  ]);
});

for (const [label, userId, permissions] of [
  ["unrelated approver", "other", ["vote_audit_approve"]],
  ["recorded approver without current permission", "guardian", []],
  ["named auditor", "auditor", ["vote_audit_view", "vote_audit_approve"]],
]) {
  test(`${label} cannot resume another approver's delivery`, async ({
    page,
  }) => {
    const world = await fixture(page, { userId, permissions });
    await expect(
      page.getByRole("button", { name: "Resume one-record disclosure" }),
    ).toBeDisabled();
    expect(world.calls).toEqual([]);
  });
}

test("only the named auditor with current view permission can request disclosure", async ({
  page,
}) => {
  const world = await fixture(page, {
    userId: "auditor",
    permissions: ["vote_audit_view"],
  });
  world.response = (_route, send) =>
    send({
      disclosure: {
        status: "DISCLOSED_TO_NAMED_AUDITOR",
        auditCaseId: world.record.auditCaseId,
        grantId: world.record.grantId,
        namedAuditorUserId: world.record.namedAuditorUserId,
        privacyMode: world.record.privacyMode,
        targetReceiptCode: world.record.targetReceiptCode,
        targetReceiptDigest: world.record.targetReceiptDigest,
        fictionalRecord: "named-auditor-only",
      },
    });
  await page
    .getByRole("button", { name: "View disclosure", exact: true })
    .click();
  await expect(
    page.locator(".shared-organization-governance-audit-output"),
  ).toContainText("named-auditor-only");
  expect(world.calls).toEqual([
    { path: `${CASE}/view`, body: { expectedVersion: 5 } },
  ]);
});

test("a changed parent manifest disables all audit actions", async ({
  page,
}) => {
  const world = await fixture(page, {
    parent: { manifestHash: "changed-manifest" },
  });
  await expect(
    page.getByText("Audit case does not match this vote.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-action="organization-audit-action"]:enabled'),
  ).toHaveCount(0);
  expect(world.calls).toEqual([]);
});

test("the second recorded approver can resume the same grant", async ({
  page,
}) => {
  const world = await fixture(page, { userId: "approver-two" });
  await page
    .getByRole("button", { name: "Resume one-record disclosure" })
    .click();
  await expect.poll(() => world.calls.length).toBe(1);
  expect(world.calls[0]).toEqual({
    path: `${CASE}/disclose`,
    body: { expectedVersion: 5 },
  });
});

test("a disclosure for another named auditor never displays the record", async ({
  page,
}) => {
  const world = await fixture(page, {
    userId: "auditor",
    permissions: ["vote_audit_view"],
  });
  world.response = (_route, send) =>
    send({
      disclosure: {
        status: "DISCLOSED_TO_NAMED_AUDITOR",
        auditCaseId: world.record.auditCaseId,
        grantId: world.record.grantId,
        namedAuditorUserId: "other-auditor",
        privacyMode: world.record.privacyMode,
        targetReceiptCode: world.record.targetReceiptCode,
        targetReceiptDigest: world.record.targetReceiptDigest,
        fictionalRecord: "must-not-render",
      },
    });
  await page
    .getByRole("button", { name: "View disclosure", exact: true })
    .click();
  await expect(
    page
      .getByText(
        "Disclosure record bindings changed. Refresh before continuing.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText("must-not-render")).toHaveCount(0);
  expect(world.calls).toHaveLength(1);
});

for (const [label, options] of [
  ["different organization", { parent: { organizationId: "other-org" } }],
  ["different vote", { parent: { voteId: "other-vote" } }],
  [
    "different privacy",
    {
      parent: {
        rules: {
          privacyMode: "SECRET_ADMIN_AUDITABLE",
          ballotMethod: "YES_NO",
        },
      },
    },
  ],
  ["uncertified parent", { parent: { status: "CLOSED" } }],
  ["invalid version", { record: caseRecord({ version: 0 }) }],
  ["anonymous privacy", { record: caseRecord({ privacyMode: "ANONYMOUS" }) }],
  ["missing grant", { record: caseRecord({ grantId: "" }) }],
]) {
  test(`${label} cannot dispatch an audit action through a forced click`, async ({
    page,
  }) => {
    const world = await fixture(page, options);
    const disclose = page.locator(
      '[data-action="organization-audit-action"][data-audit-action="disclose"]',
    );
    await expect(disclose).toBeDisabled();
    await disclose.dispatchEvent("click");
    expect(world.calls).toEqual([]);
  });
}

test("changed grant binding in a response is rejected without displaying delivery", async ({
  page,
}) => {
  const world = await fixture(page);
  world.response = (_route, send) =>
    send({
      auditCase: caseRecord({ grantId: "replacement-grant" }),
      delivery: delivery(caseRecord(), "DELIVERED"),
    });
  await page
    .getByRole("button", { name: "Resume one-record disclosure" })
    .click();
  await expect(
    page
      .getByText("Audit case bindings changed. Refresh before continuing.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("One-record delivery is ready.", { exact: true }),
  ).toHaveCount(0);
  expect(world.calls).toHaveLength(1);
});

test("pending duplicate and delayed response after navigation cannot alter another route", async ({
  page,
}) => {
  const world = await fixture(page);
  let release;
  world.response = async (_route, send) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    return send({
      auditCase: world.record,
      delivery: delivery(world.record, "DELIVERED"),
    });
  };
  const resume = page.getByRole("button", {
    name: "Resume one-record disclosure",
  });
  await resume.click();
  await expect.poll(() => world.calls.length).toBe(1);
  await resume.dispatchEvent("click");
  expect(world.calls).toHaveLength(1);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  release();
  await expect(page).toHaveURL(BASE + "/organizations/org-audit/governance");
  await expect(
    page.getByText("One-record delivery is ready.", { exact: true }),
  ).toHaveCount(0);
});

test("a version conflict stays visible and a manual refresh uses the new version", async ({
  page,
}) => {
  const world = await fixture(page);
  world.response = (_route, send) =>
    send(
      { error: "version_conflict", message: "Case changed; refresh it." },
      409,
    );
  await page
    .getByRole("button", { name: "Resume one-record disclosure" })
    .click();
  await expect.poll(() => world.calls.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Resume one-record disclosure" }),
  ).toBeEnabled();
  world.record = caseRecord({ version: 6 });
  world.response = (_route, send) =>
    send({ auditCase: world.record, delivery: delivery(world.record) });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume one-record disclosure" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Resume one-record disclosure" })
    .click();
  await expect.poll(() => world.calls.length).toBe(2);
  expect(world.calls[1].body).toEqual({ expectedVersion: 6 });
});
