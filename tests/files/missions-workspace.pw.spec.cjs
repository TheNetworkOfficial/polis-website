const { test, expect } = require("@playwright/test");
const {
  BASE_URL,
  COALITION_PATH,
  COALITION_ID,
  mockMissionsWorkspace,
} = require("./fixtures/missions-workspace.cjs");

const legacyPanels = [
  ".shared-campaign-missions-hero",
  ".shared-campaign-metrics",
  ".shared-campaign-mission-admin-command",
  ".shared-campaign-mission-staff-command",
  ".shared-coalition-metrics",
  ".shared-missions-command-center",
].join(",");

async function ready(page) {
  await expect(page.locator(".polis-missions")).toBeVisible();
  await expect(page.locator(".polis-missions")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.locator(".polis-missions .mission-row").first(),
  ).toBeVisible();
  await expect(page.locator(".shared-page__loading")).toHaveCount(0);
}

async function navigationItem(page, mobile, label) {
  if (mobile) {
    const menu = page.locator(".coalition-ui-mobile-nav");
    await expect(menu).toBeVisible();
    if ((await menu.getAttribute("open")) === null)
      await menu.locator("summary").click();
    return menu.getByRole("button", { name: label, exact: true });
  }
  return page
    .locator(".coalition-ui-sidebar")
    .getByRole("button", { name: label, exact: true });
}

async function enterThroughWorkspace(page, mobile) {
  await page.goto(`${BASE_URL}/coalitions`);
  await expect(page.locator(".polis-coalition-ui")).toBeVisible();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(1);
  await (await navigationItem(page, mobile, "Missions")).click();
  await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}/missions`);
  await ready(page);
}

async function assertCleanWorkspace(page) {
  const content = page.locator(".coalition-ui-content");
  await expect(content.locator(".coalition-ui-heading h1")).toHaveText(
    "Missions",
  );
  await expect(
    content.getByRole("heading", { name: "Missions", exact: true }),
  ).toHaveCount(1);
  await expect(content.locator(legacyPanels)).toHaveCount(0);
  expect(
    await content.evaluate((element) => {
      const heading = element.querySelector(".coalition-ui-heading");
      const workspace = element.querySelector(".polis-missions");
      return heading?.nextElementSibling === workspace;
    }),
  ).toBe(true);
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 1);
  const selectedTab = await page
    .locator('.polis-missions [role="tab"][aria-selected="true"]')
    .boundingBox();
  expect(selectedTab.x).toBeGreaterThanOrEqual(-1);
  expect(selectedTab.x + selectedTab.width).toBeLessThanOrEqual(
    overflow.viewport + 1,
  );
  expect(
    await page.evaluate(() => window.__LEGACY_MISSION_PANELS_SEEN__),
  ).toEqual([]);
}

async function selectTab(page, view) {
  await page
    .locator(
      `.polis-missions [data-action="coalition-missions-ui-view"][data-view="${view}"]`,
    )
    .click();
  await expect(
    page.locator(`.polis-missions [role="tab"][data-view="${view}"]`),
  ).toHaveAttribute("aria-selected", "true");
  await assertCleanWorkspace(page);
}

async function openMission(page, title) {
  await page
    .locator(".polis-missions .mission-row")
    .filter({ hasText: title })
    .click();
  const dialog = page.locator(".polis-missions dialog.drawer[open]");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  return dialog;
}

async function screenshot(page, testInfo, name) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: true,
    animations: "disabled",
  });
}

for (const role of ["admin", "member"]) {
  for (const mobile of [false, true]) {
    test(`approved Missions keeps every ${role} view isolated through ${mobile ? "mobile menu" : "desktop sidebar"} entry`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(120000);
      const fixture = await mockMissionsWorkspace(page, { role });
      await page.setViewportSize(
        mobile ? { width: 390, height: 1000 } : { width: 1440, height: 1100 },
      );
      await enterThroughWorkspace(page, mobile);
      await assertCleanWorkspace(page);
      const tabs =
        role === "admin"
          ? [
              "missions",
              "attention",
              "people",
              "templates",
              "timeline",
              "activity",
            ]
          : ["mine", "available", "completed"];
      await expect(page.locator(".polis-missions [role=tab]")).toHaveCount(
        tabs.length,
      );
      await expect(
        page.locator(
          '.polis-missions [data-action="coalition-missions-ui-create"]',
        ),
      ).toHaveCount(role === "admin" ? 1 : 0);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => localStorage.setItem("prefs.themeMode", value),
          theme,
        );
        await page.reload();
        await ready(page);
        await expect(page.locator("html")).toHaveAttribute(
          "data-polis-theme-resolved",
          theme,
        );
        for (const view of tabs) {
          await selectTab(page, view);
          await screenshot(
            page,
            testInfo,
            `${role}-${mobile ? "mobile" : "desktop"}-${theme}-${view}.png`,
          );
        }
        await selectTab(page, tabs[0]);
        await page
          .getByRole("button", { name: "Board view", exact: true })
          .click();
        await expect(page.locator(".polis-missions .board-column")).toHaveCount(
          4,
        );
        await assertCleanWorkspace(page);
        await screenshot(
          page,
          testInfo,
          `${role}-${mobile ? "mobile" : "desktop"}-${theme}-board.png`,
        );
        await page
          .getByRole("button", { name: "List view", exact: true })
          .click();
        if (mobile) {
          await page.setViewportSize({ width: 320, height: 760 });
          for (const view of tabs) await selectTab(page, view);
          await selectTab(page, tabs[0]);
          await screenshot(page, testInfo, `${role}-${theme}-320.png`);
          await page.setViewportSize({ width: 390, height: 1000 });
        }
      }
      expect(fixture.writes).toEqual([]);
      expect(fixture.errors).toEqual([]);
      const missionReads = fixture.requests.filter(
        (request) => request.path === "/api/missions",
      );
      expect(
        missionReads.some(
          (request) =>
            new URLSearchParams(request.query).get("view") ===
            (role === "admin" ? "admin" : "mine"),
        ),
      ).toBe(true);
      expect(
        missionReads.every(
          (request) =>
            new URLSearchParams(request.query).get("scopeId") === COALITION_ID,
        ),
      ).toBe(true);
    });
  }
}

test("Missions search, filters, sorting and keyboard tabs preserve the focused input", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/missions`);
  await ready(page);
  const root = page.locator(".polis-missions");
  const query = root.locator("[data-missions-query]");
  await query.focus();
  await query.pressSequentially("welcome", { delay: 35 });
  await expect(query).toHaveValue("welcome");
  await expect(query).toBeFocused();
  await expect(root.locator(".mission-row")).toHaveCount(2);
  await query.fill("nothing-matches-this-mission");
  await expect(
    root.getByText("No missions found", { exact: true }),
  ).toBeVisible();
  await root
    .locator('[data-action="coalition-missions-ui-clear"]')
    .first()
    .click();
  await expect(root.locator(".mission-row")).toHaveCount(12);
  await root.locator("[data-missions-status]").selectOption("submitted");
  await expect(root.locator(".mission-row")).toHaveCount(2);
  await root
    .locator('[data-action="coalition-missions-ui-clear"]')
    .first()
    .click();
  await root.locator("[data-missions-assignee]").selectOption("alex");
  await expect(root.locator(".mission-row")).toHaveCount(3);
  await root
    .locator('[data-action="coalition-missions-ui-clear"]')
    .first()
    .click();
  const before = await root.locator(".mission-row").first().innerText();
  await root.locator('[data-action="coalition-missions-ui-sort"]').click();
  await expect(root.locator(".mission-row").first()).not.toHaveText(before);
  const firstTab = root.locator('[role="tab"]').first();
  await firstTab.focus();
  await page.keyboard.press("End");
  await expect(root.locator('[data-view="activity"]')).toBeFocused();
  await expect(root.locator('[data-view="activity"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(root.locator('[data-view="missions"]')).toBeFocused();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("legacy scoped Missions links and standalone task details use the approved coalition workspace", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page, { missionDelay: 70 });
  await page.goto(
    `${BASE_URL}/missions?scopeType=coalition&scopeId=${COALITION_ID}&view=attention`,
  );
  await expect(page).toHaveURL(new RegExp(`${COALITION_PATH}/missions`));
  await expect(
    page.locator(".polis-missions [data-view=attention]"),
  ).toHaveAttribute("aria-selected", "true");
  await assertCleanWorkspace(page);
  await page.goto(
    `${BASE_URL}/missions/welcome-guide?returnTo=${encodeURIComponent(COALITION_PATH + "/missions")}`,
  );
  const dialog = page.locator(".polis-missions dialog.drawer[open]");
  await expect(
    dialog.getByRole("heading", {
      name: "Review the volunteer welcome guide",
      exact: true,
    }),
  ).toBeVisible();
  await assertCleanWorkspace(page);
  await expect(
    page.locator(
      ".shared-mission-detail-hero,.shared-mission-detail-grid,.shared-missions-metrics",
    ),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.matches(
          '.polis-missions [data-action="coalition-missions-ui-open"][data-id="welcome-guide"],.polis-missions [role="tab"][aria-selected="true"]',
        ),
      ),
    )
    .toBe(true);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

async function choosePerson(form, name, id) {
  const authorizedSelect = form.locator("[data-missions-person-target]");
  if (await authorizedSelect.count()) return authorizedSelect.selectOption(id);
  const select = form.locator('select[name="assignee"]');
  if (await select.count()) return select.selectOption(id);
  const option = form.locator(
    `[data-action="mission-create-target-select"][data-target-mode="user"][data-assignee="${id}"]`,
  );
  if (await option.count()) return option.click();
  await form.getByRole("button", { name: new RegExp(name) }).click();
}

test("mission and template dialogs submit real scoped payloads and retain drafts through selection", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page);
  const inheritedTemplate = fixture.templates[0];
  inheritedTemplate.config.successConditions.push({
    type: "required_approval",
    required: true,
  });
  await page.goto(`${BASE_URL}${COALITION_PATH}/missions`);
  await ready(page);
  await page.getByRole("button", { name: "New mission", exact: true }).click();
  let dialog = page.locator(".polis-missions dialog[open]");
  let form = dialog.locator('[data-route-form="coalition-missions-create"]');
  await form
    .locator('input[name="title"]')
    .fill("Confirm the neighborhood launch plan");
  await form
    .locator('textarea[name="description"]')
    .fill("Confirm the meeting point and report the final plan.");
  await choosePerson(form, "Priya Shah", "priya");
  await expect(form.locator('input[name="title"]')).toHaveValue(
    "Confirm the neighborhood launch plan",
  );
  await form.locator("[data-missions-due-date]").fill("2026-10-28");
  await expect(
    form.locator('input[name="presentationRequiresReview"]'),
  ).toBeChecked();
  await form
    .locator('[data-mission-disclosure="create-timing"] summary')
    .click();
  await form
    .locator('textarea[name="presentationChecklist"]')
    .fill("Confirm the meeting point\nShare the final launch plan");
  await form.locator('button[type="submit"]').click();
  await expect
    .poll(
      () =>
        fixture.writes.filter((write) => write.path === "/api/missions").length,
    )
    .toBe(1);
  const create = fixture.writes.find(
    (write) => write.path === "/api/missions",
  ).body;
  expect(create).toMatchObject({
    scopeType: "coalition",
    scopeId: COALITION_ID,
    title: "Confirm the neighborhood launch plan",
    jobs: [
      {
        target: { type: "user", userId: "priya" },
        deadline: { mode: "due_at" },
      },
    ],
  });
  expect(new Date(create.jobs[0].deadline.dueAt).getTime()).toBeGreaterThan(
    Date.now(),
  );
  expect(create.jobs[0].successConditions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "required_approval" }),
      expect.objectContaining({
        type: "checklist",
        label: "Confirm the meeting point",
      }),
      expect.objectContaining({
        type: "checklist",
        label: "Share the final launch plan",
      }),
    ]),
  );
  await expect(page.locator(".polis-missions dialog[open]")).toHaveCount(0);
  await expect(
    page
      .locator(".polis-missions .mission-row")
      .filter({ hasText: create.title }),
  ).toBeVisible();
  await selectTab(page, "templates");
  await page
    .locator(
      '.polis-missions [data-action="coalition-missions-ui-new-template"]',
    )
    .click();
  dialog = page.locator(".polis-missions dialog[open]");
  form = dialog.locator('[data-route-form="coalition-missions-template-save"]');
  await form.locator('input[name="title"]').fill("Shared launch checklist");
  await form
    .locator('textarea[name="description"]')
    .fill("A reusable launch routine.");
  await form
    .locator("[data-missions-template-category]")
    .selectOption("Field work");
  await form.locator("[data-missions-template-role]").selectOption("volunteer");
  await form
    .locator('textarea[name="presentationChecklist"]')
    .fill("Confirm the launch plan\nShare the launch result");
  await form.locator('button[type="submit"]').click();
  await expect
    .poll(
      () =>
        fixture.writes.filter(
          (write) => write.path === "/api/missions/templates",
        ).length,
    )
    .toBe(1);
  expect(
    fixture.writes.find((write) => write.path === "/api/missions/templates")
      .body,
  ).toMatchObject({
    scopeType: "coalition",
    scopeId: COALITION_ID,
    title: "Shared launch checklist",
    config: {
      category: "Field work",
      targetMode: "role_claim",
      assignee: "volunteer",
      successConditions: [
        { type: "checklist", label: "Confirm the launch plan" },
        { type: "checklist", label: "Share the launch result" },
      ],
    },
  });
  await expect(page.locator(".polis-missions dialog[open]")).toHaveCount(0);
  await expect(
    page
      .locator(".polis-missions .template-card")
      .filter({ hasText: "Shared launch checklist" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `Edit template: ${inheritedTemplate.title}`,
      exact: true,
    })
    .click();
  form = page.locator(
    '.polis-missions dialog[open] [data-route-form="coalition-missions-template-save"]',
  );
  await form
    .locator('textarea[name="presentationChecklist"]')
    .fill("Check the revised plan");
  await form.locator('button[type="submit"]').click();
  await expect
    .poll(
      () =>
        fixture.writes.filter(
          (write) =>
            write.method === "PATCH" &&
            write.path ===
              `/api/missions/templates/${inheritedTemplate.templateId}`,
        ).length,
    )
    .toBe(1);
  const update = fixture.writes.find(
    (write) =>
      write.method === "PATCH" &&
      write.path === `/api/missions/templates/${inheritedTemplate.templateId}`,
  ).body;
  expect(update.config.successConditions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "required_approval", required: true }),
      expect.objectContaining({
        type: "checklist",
        label: "Check the revised plan",
      }),
    ]),
  );
  expect(
    update.config.successConditions.filter(
      (condition) => condition.type === "checklist",
    ),
  ).toHaveLength(1);
  await expect(page.locator(".polis-missions dialog[open]")).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test("review decisions refresh the mission list and cannot discard existing evidence", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/missions`);
  await ready(page);
  await selectTab(page, "attention");
  let dialog = await openMission(page, "Review the volunteer welcome guide");
  await dialog
    .locator('[data-mission-disclosure="evidence-support"] > summary')
    .click();
  await expect(
    dialog.getByText("welcome-guide.pdf", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".mission-task-content")).toContainText(
    "The updated guide includes arrival times, accessibility information, and a short first-shift checklist.",
  );
  await dialog
    .getByRole("button", { name: /^Approve(?: mission)?$/, exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixture.missions.find(
          (mission) => mission.missionId === "welcome-guide",
        ).jobs[0].status,
    )
    .toBe("approved");
  expect(
    fixture.missions.find((mission) => mission.missionId === "welcome-guide")
      .jobs[0].artifacts[0].artifactId,
  ).toBe("welcome-guide-pdf");
  await expect(
    dialog.locator('.status-badge[data-status="completed"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator(".polis-missions .mission-row")
      .filter({ hasText: "Review the volunteer welcome guide" }),
  ).toHaveCount(0);
  dialog = await openMission(page, "Approve the early voting reminder card");
  await dialog
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  const actionForm = dialog.locator(
    '[data-route-form="mission-job-action"]:has(input[name="action"][value="request_changes"])',
  );
  await actionForm
    .locator('textarea[name="note"]')
    .fill("Please include the location and opening time.");
  await actionForm.locator('button[type="submit"]').click();
  await expect
    .poll(
      () =>
        fixture.missions.find(
          (mission) => mission.missionId === "early-voting-card",
        ).jobs[0].status,
    )
    .toBe("needs_changes");
  const decision = fixture.writes.find(
    (write) => write.body?.action === "request_changes",
  );
  expect(decision.body.note).toBe(
    "Please include the location and opening time.",
  );
  await expect(
    dialog.locator('.status-badge[data-status="changes"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(fixture.errors).toEqual([]);
});

test("member claim and required evidence flow remain authorized and update My work", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page, { role: "member" });
  const owned = fixture.missions.find(
    (mission) =>
      mission.jobs[0].assigneeUserId === "alex" &&
      mission.jobs[0].status === "active",
  );
  owned.jobs[0].successConditions.forEach((condition) => {
    condition.completed = true;
    condition.current = condition.target || 1;
  });
  owned.jobs[0].successConditions.push(
    { type: "required_approval", required: true },
    { type: "required_note", required: true },
    { type: "required_upload", label: "Upload a result", required: true },
  );
  await page.goto(`${BASE_URL}${COALITION_PATH}/missions`);
  await ready(page);
  await selectTab(page, "available");
  const initialAvailable = await page
    .locator(".polis-missions .mission-row")
    .count();
  let dialog = await openMission(page, "Pack Saturday’s canvass kits");
  await dialog
    .getByRole("button", { name: /^Claim(?: mission| task)?$/, exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixture.missions.find((mission) => mission.missionId === "pack-kits")
          .jobs[0].assigneeUserId,
    )
    .toBe("alex");
  await expect(dialog.locator(".detail-meta")).toContainText("Alex Morgan");
  await page.keyboard.press("Escape");
  await expect(page.locator(".polis-missions .mission-row")).toHaveCount(
    initialAvailable - 1,
  );
  await selectTab(page, "mine");
  await expect(
    page
      .locator(".polis-missions .mission-row")
      .filter({ hasText: "Pack Saturday’s canvass kits" }),
  ).toBeVisible();
  dialog = await openMission(page, owned.title);
  const submit = dialog.getByRole("button", {
    name: /^Submit(?: for review)?$/,
    exact: true,
  });
  await expect(submit).toBeDisabled();
  const uploadNote = dialog.locator(
    '[data-route-form="mission-job-action"]:has(input[name="action"][value="post_update"]) textarea[name="note"]',
  );
  await uploadNote.fill("Draft update survives an evidence upload.");
  await dialog
    .locator('[data-mission-disclosure="evidence-support"] > summary')
    .click();
  const uploadForm = dialog.locator(
    '[data-route-form="mission-artifact-upload"]',
  );
  await uploadForm.locator('input[type="file"]').setInputFiles({
    name: "mission-result.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Local fixture evidence"),
  });
  await uploadForm.locator('button[type="submit"]').click();
  await expect.poll(() => owned.jobs[0].artifacts.length).toBe(1);
  await expect(
    dialog.getByText("mission-result.txt", { exact: true }),
  ).toBeVisible();
  await expect(uploadNote).toHaveValue(
    "Draft update survives an evidence upload.",
  );
  await expect(submit).toBeEnabled();
  await expect(uploadNote).toHaveValue(
    "Draft update survives an evidence upload.",
  );
  await uploadNote
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Post update", exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixture.writes.filter((write) => write.body?.action === "post_update")
          .length,
    )
    .toBe(1);
  await expect(uploadNote).toHaveValue("");
  await submit.click();
  const actionForm = dialog.locator(
    '[data-route-form="mission-job-action"]:has(input[name="action"][value="submit"])',
  );
  await actionForm
    .locator('textarea[name="note"]')
    .fill("The final plan and evidence are ready for review.");
  await actionForm.locator('button[type="submit"]').click();
  await expect.poll(() => owned.jobs[0].status).toBe("submitted");
  expect(
    fixture.writes.find((write) => write.body?.action === "submit").body.note,
  ).toContain("ready for review");
  await expect(
    dialog.getByRole("button", { name: /^Approve(?: mission)?$/, exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.locator(
      '[data-route-form="mission-edit"],[data-route-form="mission-lifecycle"]',
    ),
  ).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test("review-only permission does not expose creation or template management", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page, { role: "reviewer" });
  await page.goto(`${BASE_URL}${COALITION_PATH}/missions`);
  await ready(page);
  await expect(
    page.locator(
      '.polis-missions [data-action="coalition-missions-ui-create"]',
    ),
  ).toHaveCount(0);
  await selectTab(page, "templates");
  await expect(
    page.locator(
      '.polis-missions [data-action="coalition-missions-ui-new-template"],.polis-missions [data-action="coalition-missions-ui-edit-template"]',
    ),
  ).toHaveCount(0);
  await selectTab(page, "attention");
  const dialog = await openMission(page, "Review the volunteer welcome guide");
  await expect(
    dialog.getByRole("button", { name: /^Approve(?: mission)?$/, exact: true }),
  ).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("coalition presentation does not capture a standalone campaign mission", async ({
  page,
}) => {
  const fixture = await mockMissionsWorkspace(page);
  const mission = fixture.missions.find(
    (item) => item.missionId === "prepare-launch",
  );
  mission.scopeType = "candidate";
  mission.scopeId = "candidate-demo";
  await page.goto(`${BASE_URL}/missions/${mission.missionId}`);
  await expect(page.locator(".shared-mission-detail-hero")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: mission.title, exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".polis-missions")).toHaveCount(0);
  await page.getByText("Manage mission", { exact: true }).click();
  await expect(
    page.locator('[data-route-form="mission-edit"] input[name="title"]'),
  ).toHaveValue(mission.title);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
