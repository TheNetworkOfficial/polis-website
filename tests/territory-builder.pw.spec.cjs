const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const BASE = "http://127.0.0.1:9086";
const SNAPSHOT = "a".repeat(64);
const ARTIFACTS =
  process.env.TERRITORY_BUILDER_ARTIFACTS ||
  path.join(__dirname, "../test-results/territory-builder");
const AREA = {
  type: "Polygon",
  coordinates: [
    [
      [-114.01, 46.86],
      [-114, 46.86],
      [-114, 46.87],
      [-114.01, 46.87],
      [-114.01, 46.86],
    ],
  ],
};
const RECT = (west, east) => ({
  type: "Polygon",
  coordinates: [
    [
      [west, 46.86],
      [east, 46.86],
      [east, 46.87],
      [west, 46.87],
      [west, 46.86],
    ],
  ],
});
const CUTS = [
  {
    id: "west",
    name: "West",
    geojson: RECT(-114.01, -114.005),
    trimGeometry: null,
    locked: false,
    assigneeUserId: null,
    addressCount: 3,
  },
  {
    id: "east",
    name: "East",
    geojson: RECT(-114.005, -114),
    trimGeometry: null,
    locked: false,
    assigneeUserId: null,
    addressCount: 3,
  },
];
const POINTS = [0, 1, 2, 3, 4, 5].map((i) => ({
  id: `location-${i}`,
  coordinates: [-114.009 + (i % 3) * 0.003, 46.862 + Math.floor(i / 3) * 0.004],
  doNotKnock: i === 0,
  reportedDanger: i === 1,
}));
async function fixture(
  page,
  {
    deny = false,
    conflict = false,
    incomplete = false,
    preparing = false,
    clustered = false,
  } = {},
) {
  const writes = [],
    errors = [],
    reads = [],
    viewports = [],
    sourceRequests = [];
  let sourceReady = !preparing;
  let revision = 0,
    draft = null;
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "territory-test-actor", name: "Alex Example" })).toString("base64url")}.test`;
  page.on("pageerror", (error) => errors.push(error.message));
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
      localStorage.setItem("polis.theme.v1", "light");
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: base,
            map: { styleUrl: `${base}/territory-test-style.json` },
            auth: {
              ...value.auth,
              region: "us-west-2",
              clientId: "test",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { token, base: BASE },
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === BASE ||
      (url.hostname === "unpkg.com" &&
        /^\/maplibre-gl@4\.7\.1\/dist\/maplibre-gl\.(js|css)$/.test(
          url.pathname,
        )) ||
      !url.protocol.startsWith("http")
      ? route.continue()
      : route.abort();
  });
  await page.route(`${BASE}/territory-test-style.json`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 8,
        sources: {
          roads: {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [0, 1, 2, 3, 4, 5].flatMap((i) => [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [-114.02, 46.858 + i * 0.003],
                      [-113.99, 46.858 + i * 0.003],
                    ],
                  },
                },
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [-114.013 + i * 0.003, 46.855],
                      [-114.013 + i * 0.003, 46.875],
                    ],
                  },
                },
              ]),
            },
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e7edf0" },
          },
          {
            id: "roads",
            type: "line",
            source: "roads",
            paint: { "line-color": "white", "line-width": 9 },
          },
        ],
      }),
    }),
  );
  const coalition = {
    coalitionId: "territory-fixture",
    name: "Territory browser fixture",
    voterMapEnabled: true,
    coalitionType: "ordinary",
  };
  const membership = {
    roleKey: "admin",
    status: "active",
    permissions: ["voter_map_manager"],
  };
  await page.route(`${BASE}/api/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      pathname = url.pathname;
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (pathname.includes("/territory-builder")) {
      if (request.method() === "GET") {
        expect(url.searchParams.get("protocol")).toBe("2");
        reads.push(pathname);
        return deny
          ? json({ message: "Forbidden" }, 403)
          : json({
              ok: true,
              protocolVersion: 2,
              revision,
              areas: [
                { id: "area", name: "Test operational area", geojson: AREA },
              ],
              boundary: AREA,
              points: [],
              staff: [
                {
                  userId: "eligible-staff",
                  displayName: "Sam Example",
                  username: "sam",
                },
              ],
              draft,
              source: {
                status: sourceReady ? "ready" : "preparing",
                snapshotId: sourceReady ? SNAPSHOT : null,
                mappedAddressCount: 6,
                unmappedRecordCount: 2,
                complete: sourceReady && !incomplete,
              },
              limits: { maxTerritories: 12 },
            });
      }
      const body = request.postDataJSON();
      if (pathname.endsWith("/source")) {
        sourceRequests.push(body);
        return json({ ok: true, status: sourceReady ? "ready" : "preparing" });
      }
      if (pathname.endsWith("/points")) {
        viewports.push(body);
        expect(body.snapshotId).toBe(SNAPSHOT);
        expect(body.bbox).toHaveLength(4);
        const points = POINTS.filter(
          (p) =>
            !(
              (body.contactExclusions.excludeDoNotKnock && p.doNotKnock) ||
              (body.contactExclusions.excludeReportedDanger && p.reportedDanger)
            ),
        );
        return json({
          ok: true,
          points: clustered
            ? [{ ...POINTS[0], count: 500000 }]
            : points.map((p) => ({ ...p, count: 1 })),
          source: { status: "ready", snapshotId: SNAPSHOT, complete: true },
          viewportComplete: true,
          clustered,
        });
      }
      writes.push({
        pathname,
        method: request.method(),
        body,
        actor: request.headers()["x-polis-expected-actor"],
      });
      if (conflict && pathname.endsWith("/publish"))
        return json({ message: "territory_builder_revision_conflict" }, 409);
      if (pathname.endsWith("/preview")) {
        const rows =
          body.mode === "auto" ||
          body.mode === "guided" ||
          body.mode === "split"
            ? structuredClone(CUTS)
            : body.territories.map((t) => ({ ...t, addressCount: 3 }));
        const excluded =
          Number(body.contactExclusions.excludeDoNotKnock) +
          Number(body.contactExclusions.excludeReportedDanger);
        return json({
          ok: true,
          snapshotId: SNAPSHOT,
          planHash: "b".repeat(64),
          territories: rows,
          summary: {
            totalAddressCount: 6,
            eligibleAddressCount: 6 - excluded,
            excludedAddressCount: excluded,
            allocatedAddressCount: 6 - excluded,
            unallocatedAddressCount: 0,
          },
        });
      }
      draft = {
        areaGeojson: body.areaGeojson,
        territories: body.territories,
        contactExclusions: body.contactExclusions,
        startsAt: body.startsAt,
      };
      revision++;
      return json({
        ok: true,
        revision,
        draft,
        territories: body.territories,
        published: pathname.endsWith("/publish"),
      });
    }
    if (request.method() !== "GET")
      return json({ message: "Unexpected non-builder fixture write" }, 403);
    if (pathname === "/api/profile/me")
      return json({
        profile: {
          userId: "territory-test-actor",
          displayName: "Alex Example",
          username: "alex",
        },
      });
    if (pathname === "/api/search/results")
      return json({
        items: [
          {
            userId: "eligible-staff",
            displayName: "Sam Example",
            username: "sam",
          },
        ],
        nextCursor: null,
      });
    if (pathname === "/api/candidates/candidate-fixture")
      return json({
        candidate: {
          candidateId: "candidate-fixture",
          name: "Campaign fixture",
          userId: "territory-test-actor",
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
    if (pathname.endsWith("/voter-map/access"))
      return json({
        access: {
          ok: true,
          territories: [],
          canManageTerritories: true,
          canManageCta: true,
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
    writes,
    errors,
    reads,
    viewports,
    sourceRequests,
    ready: () => {
      sourceReady = true;
    },
  };
}
const open = async (page) => {
  await page.goto(
    `${BASE}/coalitions/territory-fixture/voter-map/territories/admin`,
  );
  await expect(
    page.getByRole("heading", { name: "Where are we working?" }),
  ).toBeVisible();
};
const chooseArea = async (page) => {
  await page
    .getByRole("button", {
      name: "Saved area Test operational area",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Use this area" }).click();
};
const autoCuts = async (page) => {
  await chooseArea(page);
  await page.locator("[data-tb-count]").evaluate((node) => {
    node.value = "2";
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("[data-tb-count]").blur();
  await page
    .getByRole("button", { name: "Preview 2 territories", exact: true })
    .click();
  await expect(page.locator(".tb-territory-row")).toHaveCount(2);
};

const assign = async (page, name) => {
  await page
    .getByRole("button", { name: `Assign ${name}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Sam Example/ })
    .click();
};

test("existing coalition flow: optional filters, server cuts, named staff, review and one publish", async ({
  page,
}) => {
  const capture = await fixture(page);
  await open(page);
  const dnk = page.getByLabel("Do not knock requests"),
    danger = page.getByLabel("Reported danger issues");
  await expect(dnk).not.toBeChecked();
  await expect(danger).not.toBeChecked();
  await dnk.check();
  await danger.check();
  await dnk.uncheck();
  await danger.uncheck();
  await expect(
    page.getByLabel("Blank filter dropdown placeholder"),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Blank filter dropdown placeholder").locator("option"),
  ).toHaveCount(1);
  await expect(
    page.getByLabel("Blank filter dropdown placeholder"),
  ).toHaveValue("");
  await autoCuts(page);
  await page.getByRole("button", { name: "Assign people" }).click();
  await expect(
    page.getByRole("heading", { name: "Who’s taking each area?" }),
  ).toBeVisible();
  await assign(page, "West");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await assign(page, "West");
  await assign(page, "East");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(
    page.getByRole("dialog", { name: "Review territories" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish territories", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Territories are ready" }),
  ).toBeVisible();
  const publish = capture.writes.filter((r) => r.pathname.endsWith("/publish"));
  expect(publish).toHaveLength(1);
  expect(publish[0].body.contactExclusions).toEqual({
    excludeDoNotKnock: false,
    excludeReportedDanger: false,
  });
  expect(publish[0].body.territories[0].assigneeUserId).toBe("eligible-staff");
  expect(publish[0].actor).toBe("territory-test-actor");
  expect(capture.errors).toEqual([]);
});

test("real MapLibre supports boundary corner edits, drawing, undo, trim and saved draft reload", async ({
  page,
}) => {
  const capture = await fixture(page);
  await open(page);
  await chooseArea(page);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const canvas = page.locator(".tb-map canvas");
  await expect(canvas).toBeVisible({ timeout: 25000 });
  const box = await canvas.boundingBox();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.6, 0.3],
    [0.6, 0.65],
    [0.3, 0.65],
  ])
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  await page.getByRole("button", { name: "Finish shape" }).click();
  await expect(page.locator(".tb-territory-row")).toHaveCount(1);
  const corner = page
    .getByRole("button", { name: "Boundary corner 1." })
    .first();
  await expect(corner).toBeVisible();
  await corner.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Check coverage" }).click();
  const moved = capture.writes.findLast((r) => r.pathname.endsWith("/preview"))
    .body.territories[0].geojson;
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await page.getByRole("button", { name: "Check coverage" }).click();
  expect(
    capture.writes.findLast((r) => r.pathname.endsWith("/preview")).body
      .territories[0].geojson,
  ).not.toEqual(moved);
  const handleBox = await corner.boundingBox();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 8,
    handleBox.y + handleBox.height / 2 + 5,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Check coverage" }).click();
  await page
    .getByRole("button", { name: "Trim territory", exact: true })
    .click();
  for (const [x, y] of [
    [0.32, 0.34],
    [0.4, 0.34],
    [0.4, 0.45],
    [0.32, 0.45],
  ])
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  await page.getByRole("button", { name: "Finish shape" }).click();
  await page.locator(".tb-extra-tools summary").click();
  await expect(
    page.getByRole("button", { name: "Restore trim" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const save = capture.writes.findLast((r) => r.pathname.endsWith("/draft"));
  expect(save.body.territories[0].trimGeometry.type).toBe("MultiPolygon");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Where are we working?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use this area" }).click();
  await expect(page.locator(".tb-territory-row")).toHaveCount(1);
  expect(capture.errors).toEqual([]);
});

test("desktop and phone layouts keep real map editing and assignment controls accessible", async ({
  page,
}) => {
  const capture = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  await autoCuts(page);
  await expect(page.locator(".tb-map canvas")).toBeVisible({ timeout: 25000 });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await expect.poll(() => capture.viewports.length).toBeGreaterThan(0);
  await page
    .locator(".territory-builder")
    .screenshot({ path: path.join(ARTIFACTS, "desktop-cut.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".territory-builder")
    .screenshot({ path: path.join(ARTIFACTS, "phone-cut.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Assign people" }).click();
  await expect(
    page.getByRole("button", { name: "Assign West", exact: true }),
  ).toBeVisible();
  await page
    .locator(".territory-builder")
    .screenshot({ path: path.join(ARTIFACTS, "phone-assign.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  expect(capture.errors).toEqual([]);
});

test("publish conflict preserves the draft and explains reload; no automatic second write", async ({
  page,
}) => {
  const capture = await fixture(page, { conflict: true });
  await open(page);
  await autoCuts(page);
  await page.getByRole("button", { name: "Assign people" }).click();
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await assign(page, "West");
  await assign(page, "East");
  await page.getByRole("button", { name: "Review" }).click();
  await page
    .getByRole("button", { name: "Publish territories", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(/changed.*Reload/),
  ).toBeVisible();
  expect(
    capture.writes.filter((r) => r.pathname.endsWith("/publish")),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".tb-territory-row")).toHaveCount(2);
});

test("incomplete authorized data blocks planning instead of inventing totals", async ({
  page,
}) => {
  const capture = await fixture(page, { incomplete: true });
  await page.goto(
    `${BASE}/coalitions/territory-fixture/voter-map/territories/admin`,
  );
  await expect(
    page.getByText(/Address preparation status is unavailable/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this area" })).toHaveCount(
    0,
  );
  expect(capture.writes).toHaveLength(0);
});

test("preparing addresses leaves geometry editing and draft save usable without invented totals", async ({
  page,
}) => {
  const capture = await fixture(page, { preparing: true });
  await open(page);
  await page
    .getByRole("button", {
      name: "Saved area Test operational area",
      exact: true,
    })
    .click();
  await expect(page.locator("[data-tb-status]")).toContainText(
    "Preparing addresses",
  );
  await expect(
    page.getByText("Preparing addresses…", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(
    capture.writes.filter((r) => r.pathname.endsWith("/draft")),
  ).toHaveLength(1);
  expect(capture.viewports).toHaveLength(0);
  await page.getByRole("button", { name: "Use this area" }).click();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Draw territory", exact: true }).first(),
  ).toBeVisible();
  capture.ready();
  await page
    .getByRole("button", { name: "Area", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Review address issues", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh addresses", exact: true })
    .click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await expect.poll(() => capture.viewports.length).toBeGreaterThan(0);
  expect(capture.errors).toEqual([]);
});

test("500,000-address cluster remains map-only; preview provides authoritative totals and both optional filters refresh the viewport", async ({
  page,
}) => {
  const capture = await fixture(page, { clustered: true });
  await open(page);
  await page
    .getByRole("button", {
      name: "Saved area Test operational area",
      exact: true,
    })
    .click();
  await expect.poll(() => capture.viewports.length).toBeGreaterThan(0);
  await expect(page.locator(".tb-filter-summary")).toHaveText(
    "6 included · 0 excluded",
  );
  await page.getByLabel("Do not knock requests", { exact: true }).check();
  await expect(page.locator(".tb-filter-summary")).toHaveText("");
  await expect
    .poll(() => capture.viewports.at(-1)?.contactExclusions.excludeDoNotKnock)
    .toBe(true);
  await page.getByLabel("Reported danger issues", { exact: true }).check();
  await expect
    .poll(
      () => capture.viewports.at(-1)?.contactExclusions.excludeReportedDanger,
    )
    .toBe(true);
  await page.getByLabel("Do not knock requests", { exact: true }).uncheck();
  await page.getByLabel("Reported danger issues", { exact: true }).uncheck();
  await expect
    .poll(() => capture.viewports.at(-1)?.contactExclusions)
    .toEqual({ excludeDoNotKnock: false, excludeReportedDanger: false });
  await expect(
    page.getByLabel("Blank filter dropdown placeholder"),
  ).toBeEnabled();
  expect(capture.errors).toEqual([]);
});

test("existing territory tools and named person selection remain available; back preserves the draft", async ({
  page,
}) => {
  const capture = await fixture(page);
  await open(page);
  await autoCuts(page);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByLabel("Territory name", { exact: true })
    .fill("My saved outline");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page
    .getByRole("button", { name: "Existing territories", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Existing territories" }),
  ).toBeVisible();
  await expect(page.locator(".territory-builder")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Assignments Manage staff access",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Choose assignee", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Choose a person" })
    .getByRole("searchbox")
    .fill("Sam");
  await page
    .getByRole("button", { name: "Sam Example (@sam)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sam Example (@sam)", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to builder", exact: true })
    .click();
  await expect(page.locator(".tb-territories")).toContainText(
    "My saved outline",
  );
  await expect(
    page.getByRole("heading", { name: "Existing territories" }),
  ).toHaveCount(0);
  expect(capture.errors).toEqual([]);
});

test("candidate route uses the same builder with explicit scope and no new navigation", async ({
  page,
}) => {
  const capture = await fixture(page);
  await page.goto(
    `${BASE}/candidate/voter-map/territories/admin?candidateId=candidate-fixture`,
  );
  await expect(
    page.getByRole("heading", { name: "Where are we working?" }),
  ).toBeVisible();
  await autoCuts(page);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  expect(capture.reads).toContain(
    "/api/candidate-dashboard/voter-map/territory-builder",
  );
  expect(capture.writes.at(-1).pathname).toBe(
    "/api/candidate-dashboard/voter-map/territory-builder/draft",
  );
  expect(capture.errors).toEqual([]);
});

test("Pan moves the real map with mouse and touch and survives filter redraws", async ({
  page,
}) => {
  const capture = await fixture(page);
  await open(page);
  await autoCuts(page);
  await expect.poll(() => capture.viewports.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pan map", exact: true }).click();
  const canvas = page.locator(".tb-map canvas");
  await canvas.scrollIntoViewIfNeeded();
  let box = await canvas.boundingBox();
  const before = capture.viewports.at(-1).bbox;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.6 + 80,
    box.y + box.height * 0.6 + 35,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect.poll(() => capture.viewports.at(-1).bbox).not.toEqual(before);
  // Wait for inertial motion to finish via a stable request count.
  await expect
    .poll(() => capture.viewports.at(-1).contactExclusions.excludeDoNotKnock)
    .toBe(false);
  await page.getByLabel("Do not knock requests", { exact: true }).check();
  await expect
    .poll(() => capture.viewports.at(-1).contactExclusions.excludeDoNotKnock)
    .toBe(true);
  const afterRedraw = capture.viewports.at(-1).bbox;
  expect(Math.abs(afterRedraw[0] - before[0])).toBeGreaterThan(0.0001);
  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Pan map", exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  box = await canvas.boundingBox();
  await expect
    .poll(
      () => capture.viewports.at(-1).bbox[2] - capture.viewports.at(-1).bbox[0],
    )
    .toBeLessThan(before[2] - before[0]);
  const touchBefore = [...capture.viewports.at(-1).bbox];
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const point = {
    x: Math.round(box.x + box.width * 0.55),
    y: Math.round(Math.max(120, Math.min(600, box.y + box.height * 0.55))),
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, id: 1 }],
  });
  for (let i = 1; i <= 6; i++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x - 10 * i, y: point.y + 3 * i, id: 1 }],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => capture.viewports.at(-1).bbox)
    .not.toEqual(touchBefore);
  expect(capture.errors).toEqual([]);
});

test("approved rename, guided draw, Keep shape, schedule, clearance and draft-review controls work", async ({
  page,
}) => {
  const capture = await fixture(page);
  await open(page);
  await chooseArea(page);
  await page.getByRole("button", { name: "Guided", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Draw first territory", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await page.locator("[data-tb-count]").evaluate((node) => {
    node.value = "2";
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page
    .getByRole("button", { name: "Preview 2 territories", exact: true })
    .click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Territory name", { exact: true }).fill("River walk");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("button", { name: "Keep shape", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlock", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Assign people" }).click();
  await page
    .getByRole("button", { name: "Assign available people", exact: true })
    .click();
  await expect(page.locator(".tb-territories")).toContainText("Sam Example");
  await page
    .getByRole("button", { name: "When published", exact: false })
    .click();
  await page.getByLabel("Start time", { exact: true }).fill("2026-10-20T10:00");
  await page
    .getByRole("button", { name: "Use this time", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View team clearance", exact: false })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Sam Example");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: false }).click();
  await page
    .getByRole("button", { name: "Keep as draft", exact: true })
    .click();
  expect(
    capture.writes.filter((item) => item.pathname.endsWith("/publish")),
  ).toHaveLength(0);
  expect(
    capture.writes.findLast((item) => item.pathname.endsWith("/draft")).body
      .startsAt,
  ).toContain("2026-10-20");
  expect(capture.errors).toEqual([]);
});
