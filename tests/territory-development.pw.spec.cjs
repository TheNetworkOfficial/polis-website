const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const artifacts = `${process.env.POLIS_TERRITORY_TEST_ARTIFACTS || "D:/CodexHome/artifacts/polis-geocodio-development-20261015/website"}/playwright`;
const scopeRoute = (scope, section = "") =>
  scope === "coalition"
    ? `/coalitions/territory-fixture/voter-map${section ? `/${section}` : ""}`
    : `/candidate/voter-map${section ? `/${section}` : ""}?candidateId=candidate-fixture`;
async function fixture(page, testInfo, capability = false) {
  const base = testInfo.project.use.baseURL,
    calls = [],
    external = [],
    state = { capability, hold: null };
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "territory-test-actor", name: "Alex Example" })).toString("base64url")}.fixture`;
  await page.addInitScript(
    ({ token, base }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: Date.now() + 3600000,
        }),
      );
      localStorage.setItem("POLIS_TERRITORY_DEVELOPMENT_ENABLED", "true");
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: base,
            territoryDevelopmentAccess: true,
            territoryDevelopmentEnabled: true,
            auth: {
              ...value.auth,
              region: "us-west-2",
              clientId: "fixture",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { token, base },
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || !url.protocol.startsWith("http"))
      return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  const coalition = {
    coalitionId: "territory-fixture",
    name: "Territory fixture",
    voterMapEnabled: true,
    coalitionType: "ordinary",
  };
  const membership = {
    roleKey: "admin",
    status: "active",
    permissions: ["voter_map_manager"],
  };
  await page.route(`${base}/api/**`, async (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    calls.push({ path: pathname, method: request.method() });
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const book = "/api/contact-book/scopes/coalition%3Aterritory-fixture";
    if (pathname.startsWith(book)) {
      const suffix = pathname.slice(book.length);
      const election = {
        electionId: "fixture-election",
        name: "Fixture election",
        electionDate: "2026-11-03",
        state: "AZ",
        county: "Pinal",
        activeSnapshotId: "fixture-snapshot",
      };
      if (suffix === "/schema")
        return json({
          ok: true,
          fields: [
            {
              fieldId: "displayName",
              label: "Name",
              type: "text",
              group: "Identity",
            },
          ],
          tags: [],
          sources: [],
          capabilities: { read: true, ballotChaser: true, select: true },
        });
      if (suffix === "/ballot-chaser/elections")
        return json({ ok: true, items: [election] });
      if (suffix === "/ballot-chaser/elections/fixture-election")
        return json({ ok: true, election });
      if (suffix === "/ballot-chaser/elections/fixture-election/dashboard")
        return json({
          ok: true,
          dashboard: {
            snapshotId: "fixture-snapshot",
            coverage: "complete",
            total: 1,
            outstanding: 1,
            returned: 0,
          },
        });
      if (suffix === "/query")
        return json({
          ok: true,
          items: [
            {
              contactId: "contact-one",
              revision: 1,
              fields: { displayName: "Alex Example" },
              tags: [],
              sources: [],
            },
          ],
          complete: true,
          total: 1,
          bookRevision: 1,
        });
      return json({ ok: true, items: [], count: 1, complete: true });
    }
    if (pathname.endsWith("/voter-map/access")) {
      if (state.hold) await state.hold;
      return json({
        ok: true,
        access: {
          ok: true,
          scope: "territories",
          canManageTerritories: true,
          capabilities: { territoryDevelopmentAccess: state.capability },
          territories: [
            {
              territoryId: "assigned",
              name: "Assigned neighborhood",
              recordCount: 7,
              bbox: [0, 0, 1, 1],
            },
          ],
        },
      });
    }
    if (pathname.includes("/territory-builder"))
      return json({
        ok: true,
        protocolVersion: 2,
        revision: 0,
        areas: [],
        boundary: null,
        points: [],
        staff: [],
        draft: null,
        source: {
          status: "ready",
          complete: true,
          snapshotId: "a".repeat(64),
          recordCount: 7,
          unmappedRecordCount: 0,
        },
        limits: { maxTerritories: 12 },
      });
    if (request.method() !== "GET")
      return json({ error: "unexpected_fixture_write" }, 403);
    if (pathname === "/api/profile/me")
      return json({
        profile: {
          userId: "territory-test-actor",
          displayName: "Alex Example",
          username: "alex",
        },
      });
    if (pathname === "/api/coalitions")
      return json({ items: [{ coalition, membership }] });
    if (pathname === "/api/coalitions/territory-fixture")
      return json({ coalition, membership });
    if (pathname.endsWith("/access/catalog"))
      return json({
        roles: [
          { roleKey: "admin", label: "Admin", enabled: true, system: true },
        ],
        canManage: true,
      });
    if (pathname === "/api/candidates/candidate-fixture")
      return json({
        candidate: {
          candidateId: "candidate-fixture",
          name: "Campaign fixture",
          userId: "territory-test-actor",
        },
      });
    if (pathname === "/api/candidateDashboard/candidates")
      return json({
        candidates: [
          {
            candidateId: "candidate-fixture",
            name: "Campaign fixture",
            isOwner: true,
            permissions: ["voter_map_manager"],
          },
        ],
      });
    if (pathname.startsWith("/api/candidateDashboard/candidate-fixture"))
      return json({
        candidate: {
          candidateId: "candidate-fixture",
          name: "Campaign fixture",
        },
        access: {
          candidateId: "candidate-fixture",
          isOwner: true,
          permissions: ["voter_map_manager"],
        },
      });
    return json({
      ok: true,
      items: [],
      members: [],
      workspaces: [],
      territories: [],
    });
  });
  return {
    calls,
    external,
    state,
    builderCalls: () =>
      calls.filter((row) => row.path.includes("/territory-builder")),
  };
}

for (const scope of ["coalition", "candidate"]) {
  test(`${scope} ordinary admin menus omit management and retain assigned territories`, async ({
    page,
  }, info) => {
    const f = await fixture(page, info);
    await page.goto(scopeRoute(scope));
    if (scope === "candidate") {
      await expect(
        page.locator('[data-route*="territories/admin"]'),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Open map", exact: true }).click();
    }
    await expect(
      page.getByText("Assigned neighborhood", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('[data-route*="territories/admin"]')).toHaveCount(
      0,
    );
    await expect(page.locator(".territory-builder")).toHaveCount(0);
    expect(f.builderCalls()).toEqual([]);
  });
  for (const route of ["territories/admin", "territories", "territory-admin"]) {
    test(`${scope} direct ${route} stays closed for an ordinary admin`, async ({
      page,
    }, info) => {
      const f = await fixture(page, info);
      await page.goto(scopeRoute(scope, route));
      await expect(
        page.getByText("This tool is unavailable.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(
          ".territory-builder,[data-territory-builder-host],[data-route-form*='territory-']",
        ),
      ).toHaveCount(0);
      expect(f.builderCalls()).toEqual([]);
    });
  }
  test(`${scope} strict capability and development build must agree`, async ({
    page,
  }, info) => {
    const f = await fixture(page, info, true);
    await page.goto(scopeRoute(scope, "territories/admin"));
    if (info.project.name === "development") {
      await expect(
        page.getByRole("heading", { name: "Where are we working?" }),
      ).toBeVisible();
      await expect.poll(() => f.builderCalls().length).toBeGreaterThan(0);
    } else {
      await expect(
        page.getByText("This tool is unavailable.", { exact: true }),
      ).toBeVisible();
      expect(f.builderCalls()).toEqual([]);
      expect(
        f.calls.filter((row) => row.path.endsWith("/voter-map/access")),
      ).toEqual([]);
    }
    expect(f.calls.filter((row) => row.method !== "GET")).toEqual([]);
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: `${artifacts}/${info.project.name}-${scope}-wizard.png`,
      fullPage: true,
    });
  });
  test(`${scope} navigation rechecks tester access before reopening the wizard`, async ({
    page,
  }, info) => {
    const f = await fixture(page, info, true);
    await page.goto(scopeRoute(scope));
    const shortcut = page.locator('[data-route*="territories/admin"]');
    if (info.project.name === "production") {
      await expect(shortcut).toHaveCount(0);
      return;
    }
    await shortcut.first().click();
    await expect(
      page.getByRole("heading", { name: "Where are we working?" }),
    ).toBeVisible();
    f.state.capability = false;
    await page.goBack();
    await page.goForward();
    await expect(
      page.getByText("This tool is unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".territory-builder")).toHaveCount(0);
    expect(f.calls.filter((row) => row.method !== "GET")).toEqual([]);
  });
  test(`${scope} string capability cannot open the tool`, async ({
    page,
  }, info) => {
    const f = await fixture(page, info, "true");
    await page.goto(scopeRoute(scope, "territories/admin"));
    await expect(
      page.getByText("This tool is unavailable.", { exact: true }),
    ).toBeVisible();
    expect(f.builderCalls()).toEqual([]);
  });
}

test("forged legacy controls cannot dispatch work from the denied route", async ({
  page,
}, info) => {
  const f = await fixture(page, info);
  await page.goto(scopeRoute("coalition", "territories/admin"));
  await expect(
    page.getByText("This tool is unavailable.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Fixture old control";
    button.dataset.action = "coalition-territory-generation-complete";
    const form = document.createElement("form");
    form.dataset.routeForm = "coalition-territory-generation-start";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Fixture old submit";
    form.append(submit);
    document.getElementById("shared-feed-app").append(button, form);
    button.click();
    form.requestSubmit();
  });
  expect(f.calls.filter((row) => row.method !== "GET")).toEqual([]);
  expect(f.builderCalls()).toEqual([]);
});

test("grant stays closed during access refresh and after revocation", async ({
  page,
}, info) => {
  const f = await fixture(page, info, true);
  await page.goto(scopeRoute("coalition", "territories/admin"));
  if (info.project.name === "production") {
    await expect(
      page.getByText("This tool is unavailable.", { exact: true }),
    ).toBeVisible();
    expect(f.builderCalls()).toEqual([]);
    return;
  }
  await expect(
    page.getByRole("heading", { name: "Where are we working?" }),
  ).toBeVisible();
  let release;
  f.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  f.state.capability = false;
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Fixture refresh access";
    button.dataset.action = "coalition-voter-map-refresh";
    document.getElementById("shared-feed-app").append(button);
    button.click();
  });
  await expect(page.locator(".territory-builder")).toHaveCount(0);
  release();
  await expect(
    page.getByText("This tool is unavailable.", { exact: true }),
  ).toBeVisible();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({
    path: `${artifacts}/development-revoked.png`,
    fullPage: true,
  });
});

test("Ballot Chaser territory handoff requires its own fresh development grant", async ({
  page,
}, info) => {
  const f = await fixture(page, info, true);
  await page.goto("/workspace/coalition/territory-fixture/work/ballot-chaser");
  await page.getByRole("button", { name: "Show ballots not returned" }).click();
  await expect(
    page.getByText("Alex Example", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  const handoff = page.getByRole("button", {
    name: "Build DoorKnocker territories",
  });
  if (info.project.name === "development") {
    await expect(handoff).toBeVisible();
    expect(
      f.calls.filter((row) => row.path.endsWith("/voter-map/access")),
    ).toHaveLength(1);
  } else {
    await expect(handoff).toHaveCount(0);
    expect(
      f.calls.filter((row) => row.path.endsWith("/voter-map/access")),
    ).toHaveLength(0);
  }
  expect(f.builderCalls()).toEqual([]);
  expect(
    f.calls.filter(
      (row) => row.method !== "GET" && !row.path.endsWith("/query"),
    ),
  ).toEqual([]);
});
