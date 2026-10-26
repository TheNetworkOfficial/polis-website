const { test, expect } = require("@playwright/test");
const {
  BASE_URL,
  COALITION_PATH,
  mockCalendarWorkspace,
} = require("./fixtures/calendar-workspace.cjs");

const app = (page) => page.locator(".coalition-calendar-page");
const action = (page, name, suffix = "") =>
  app(page).locator(`[data-cal-action="${name}"]${suffix}`);
const dialog = (page, kind = "detail") =>
  app(page).locator(`[data-cal-dialog="${kind}"][open]`);
const field = (page, name) =>
  app(page).locator(`[data-cal-form="create"] [name="${name}"]`);

async function ready(page) {
  await expect(app(page)).toBeVisible();
  await expect(app(page).locator(".month-grid")).toBeVisible();
  await expect(app(page).locator(".calendar-event")).not.toHaveCount(0);
}

async function enter(page, options = {}) {
  const fixture = await mockCalendarWorkspace(page, options);
  await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
  if (options.role !== "denied" && options.membershipStatus !== "pending")
    await ready(page);
  return fixture;
}

async function view(page, name) {
  await action(page, "view", `[data-view="${name}"]`).click();
  await expect(action(page, "view", `[data-view="${name}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function openCreate(page) {
  await action(page, "new-item").first().click();
  await expect(dialog(page, "create")).toBeVisible();
}

async function finish(page, fixture) {
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.blockedExternalRequests).toEqual([]);
  for (const row of fixture.writes) {
    expect(row.headers.authorization).toMatch(/^Bearer /u);
    const actorHeaders = Object.keys(row.headers).filter((name) =>
      /expected.*actor/iu.test(name),
    );
    expect(actorHeaders).toEqual(["x-polis-expected-actor"]);
    const claims = JSON.parse(
      Buffer.from(
        row.headers.authorization.split(" ")[1].split(".")[1],
        "base64url",
      ).toString(),
    );
    expect(row.headers["x-polis-expected-actor"]).toBe(claims.sub);
  }
}

async function monthFits(page, weekCount) {
  await expect(app(page).locator(".month-grid")).toHaveAttribute(
    "data-weeks",
    String(weekCount),
  );
  const typography = await app(page).evaluate((root) => ({
    family: getComputedStyle(root).fontFamily,
    headings: [...root.querySelectorAll("h1,h2,h3,h4")].map((heading) => ({
      text: heading.textContent,
      family: getComputedStyle(heading).fontFamily,
    })),
  }));
  expect(typography.family).toContain("Inter");
  for (const heading of typography.headings)
    expect(heading.family, `Calendar heading font: ${heading.text}`).toBe(
      typography.family,
    );
  const geometry = await app(page).evaluate((root) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      };
    };
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      cells: [...root.querySelectorAll(".day-cell")].map(rect),
      footer: rect(root.querySelector(".calendar-footer")),
      rail: root.querySelector(".calendar-layout > .day-agenda")
        ? rect(root.querySelector(".calendar-layout > .day-agenda"))
        : null,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.cells).toHaveLength(7 * weekCount);
  for (const cell of geometry.cells) {
    expect(cell.x).toBeGreaterThanOrEqual(-1);
    expect(cell.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(cell.y).toBeGreaterThanOrEqual(-1);
    expect(cell.bottom).toBeLessThanOrEqual(geometry.footer.y + 1);
  }
  expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.height + 1);
  return geometry;
}

for (const role of ["admin", "member"]) {
  for (const size of [
    { width: 1920, height: 950 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    test(`approved Calendar month fits ${role} at ${size.width}px with right agenda or mobile day details`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(size);
      const fixture = await enter(page, { role });
      const mobile = size.width <= 760;
      await monthFits(page, 5);
      const rail = app(page).locator(".calendar-layout > .day-agenda");
      if (mobile) await expect(rail).toBeHidden();
      else {
        await expect(rail).toBeVisible();
        expect(Math.round((await rail.boundingBox()).width)).toBe(280);
      }
      await app(page).locator('.day-number[data-day="2026-10-26"]').click();
      const selected = mobile ? dialog(page) : rail;
      await expect(selected).toContainText("Weekly team briefing");
      await expect(selected).toContainText("North Cedar neighborhood canvass");
      await expect(selected).toContainText("Community partner check-in");
      if (!mobile) {
        await expect(dialog(page)).toHaveCount(0);
        const scrolling = await rail.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          return {
            own: element.scrollTop,
            needed: element.scrollHeight > element.clientHeight + 1,
            page: document.scrollingElement.scrollTop,
          };
        });
        if (scrolling.needed) expect(scrolling.own).toBeGreaterThan(0);
        expect(scrolling.page).toBe(0);
        const overflow = await app(page)
          .locator('.day-number[data-day="2026-10-26"]')
          .evaluate((element) => {
            const cell = element.closest(".day-cell"),
              visible = [...cell.querySelectorAll(".calendar-event")].filter(
                (item) => !item.hidden,
              ).length,
              more = cell.querySelector(".more-events");
            return {
              visible,
              more: more?.textContent,
              moreHidden: more?.hidden,
            };
          });
        if (overflow.visible < 3)
          expect(overflow.more).toBe(`+${3 - overflow.visible}`);
        else expect(overflow.moreHidden).toBe(true);
      }
      await selected
        .locator('[data-cal-action="item"][data-id="briefing"]')
        .click();
      await expect(dialog(page)).toContainText("Weekly team briefing");
      await page.keyboard.press("Escape");
      await action(page, "next").click();
      await monthFits(page, 6);
      await page.screenshot({
        path: testInfo.outputPath(
          `calendar-${role}-${size.width}-six-week.png`,
        ),
        animations: "disabled",
      });
      await action(page, "previous").click();
      await monthFits(page, 5);
      expect(await action(page, "new-item", ":visible").count()).toBe(
        role === "admin" ? (mobile ? 1 : 2) : 0,
      );
      await finish(page, fixture);
    });
  }
}

test("Calendar search, type/status filters, week and agenda dates show authoritative schedule items", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await enter(page);
  await app(page).locator("[data-cal-search]").fill("North Cedar");
  await expect(app(page).locator(".calendar-event")).toHaveCount(1);
  await expect(app(page).locator(".calendar-event")).toContainText(
    "North Cedar neighborhood canvass",
  );
  await app(page)
    .locator("[data-cal-search]")
    .fill("nothing matches this phrase");
  await expect(app(page)).toContainText("No matching");
  await action(page, "clear-filters").first().click();
  await app(page).locator("[data-cal-type]").selectOption("volunteer_shift");
  await expect(app(page).locator(".calendar-event")).toHaveCount(4);
  await action(page, "clear-filters").first().click();
  await app(page).locator("[data-cal-status]").selectOption("pending_approval");
  await expect(app(page).locator(".calendar-event")).toHaveCount(1);
  await expect(app(page).locator(".calendar-event")).toContainText(
    "Community partner check-in",
  );
  await action(page, "clear-filters").first().click();
  await view(page, "week");
  await expect(app(page).locator(".week-day")).toHaveCount(7);
  await expect(app(page)).toContainText("North Cedar neighborhood canvass");
  await action(page, "next").click();
  await expect(app(page)).toContainText("Weekly team briefing");
  await action(page, "today").click();
  await view(page, "agenda");
  await expect(app(page).locator(".agenda-row")).toHaveCount(9);
  await app(page).locator(".agenda-date-range summary").click();
  await app(page).locator("[data-cal-from]").fill("2026-10-28");
  await app(page).locator("[data-cal-to]").fill("2026-10-29");
  await expect(app(page).locator(".agenda-row")).toHaveCount(3);
  await app(page).locator("[data-cal-to]").fill("2026-10-27");
  await expect(app(page)).toContainText("date range");
  await action(page, "whole-month").click();
  await expect(app(page).locator(".agenda-row")).toHaveCount(20);
  await finish(page, fixture);
});

test("Calendar connections expose import/write status and provider attention without connection management", async ({
  page,
}) => {
  const fixture = await enter(page);
  await action(page, "tab", '[data-tab="connections"]').click();
  await expect(app(page).locator(".connection-card")).toHaveCount(2);
  await app(page)
    .locator(".connection-card")
    .filter({ hasText: "Google Calendar" })
    .click();
  await expect(dialog(page)).toContainText("Coalition events");
  await expect(dialog(page)).toContainText(/new items|destination/iu);
  await page.keyboard.press("Escape");
  await app(page)
    .locator(".connection-card")
    .filter({ hasText: "Microsoft" })
    .click();
  await expect(dialog(page)).toContainText(/attention|access/iu);
  await expect(
    dialog(page).getByRole("button", {
      name: /disconnect|connect account|save connection/iu,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await finish(page, fixture);
});

for (const role of ["admin", "manager", "promotion"]) {
  test(`Calendar ${role} creates a persisted API item with validated fields and fresh permitted write destinations`, async ({
    page,
  }) => {
    const fixture = await enter(page, { role });
    await openCreate(page);
    await field(page, "title").fill(
      "Community planning <script>sample</script>",
    );
    await field(page, "type").selectOption("campaign_event");
    await field(page, "status").selectOption("confirmed");
    await field(page, "start").fill("2026-10-27T18:00");
    await field(page, "end").fill("2026-10-27T19:30");
    await field(page, "location").fill("Cedar Community Hall");
    await field(page, "description").fill("Bring your questions and ideas.");
    await field(page, "labels").fill("Community, Team");
    await dialog(page, "create").locator(".advanced-settings summary").click();
    await field(page, "privacy").selectOption("busy_only");
    if (role === "promotion")
      await expect(field(page, "writeTarget")).toHaveCount(0);
    else await field(page, "writeTarget").check();
    await dialog(page, "create")
      .getByRole("button", { name: "Add calendar item", exact: true })
      .click();
    await expect.poll(() => fixture.writes.length).toBe(1);
    const body = fixture.writes[0].body;
    expect(body).toMatchObject({
      title: "Community planning <script>sample</script>",
      itemType: "campaign_event",
      status: "confirmed",
      privacy: "busy_only",
      timeZone: "America/Denver",
      allDay: false,
      startAt: Date.parse("2026-10-28T00:00:00Z"),
      endAt: Date.parse("2026-10-28T01:30:00Z"),
      locationName: "Cedar Community Hall",
      description: "Bring your questions and ideas.",
      labels: ["Community", "Team"],
      externalWriteTargets:
        role === "promotion"
          ? []
          : [
              {
                provider: "google",
                calendarId: "coalition-events",
                mode: "write",
              },
            ],
    });
    await expect(dialog(page)).toContainText(
      "Community planning <script>sample</script>",
    );
    await expect(dialog(page).locator("script")).toHaveCount(0);
    if (role !== "promotion")
      await expect(dialog(page)).toContainText(/requested|not yet confirmed/iu);
    await page.keyboard.press("Escape");
    await action(page, "refresh").click();
    await expect(
      app(page).locator('.calendar-event[data-id="created-1"]'),
    ).toHaveCount(1);
    await app(page).locator('.day-number[data-day="2026-10-27"]').click();
    await app(page)
      .locator(
        '.calendar-layout > .day-agenda [data-cal-action="item"][data-id="created-1"]',
      )
      .click();
    await expect(dialog(page)).toContainText(
      "Community planning <script>sample</script>",
    );
    await finish(page, fixture);
  });
}

test("Calendar creation validation rejects missing title, reversed times and DST gaps before any write", async ({
  page,
}) => {
  const fixture = await enter(page);
  await openCreate(page);
  const form = dialog(page, "create").locator("form");
  await dialog(page, "create")
    .getByRole("button", { name: "Add calendar item", exact: true })
    .click();
  expect(
    await field(page, "title").evaluate(
      (element) => element.validity.valueMissing,
    ),
  ).toBe(true);
  expect(fixture.writes).toHaveLength(0);
  await field(page, "title").fill("Invalid time example");
  await field(page, "start").fill("2026-10-27T19:30");
  await field(page, "end").fill("2026-10-27T18:00");
  await form.evaluate((element) => element.requestSubmit());
  await expect(dialog(page, "create")).toContainText(/after|later/iu);
  expect(fixture.writes).toHaveLength(0);
  await field(page, "start").fill("2027-03-14T02:30");
  await field(page, "end").fill("2027-03-14T04:00");
  await form.evaluate((element) => element.requestSubmit());
  await expect(dialog(page, "create")).toContainText(
    /daylight|time does not|nonexistent|valid local/iu,
  );
  expect(fixture.writes).toHaveLength(0);
  await field(page, "start").fill("2026-11-01T01:30");
  await field(page, "end").fill("2026-11-01T03:00");
  await form.evaluate((element) => element.requestSubmit());
  await expect(dialog(page, "create")).toContainText(
    /ambiguous|twice|daylight/iu,
  );
  expect(fixture.writes).toHaveLength(0);
  await finish(page, fixture);
});

test("Calendar all-day multi-day item uses exclusive midnight boundaries and survives refresh", async ({
  page,
}) => {
  const fixture = await enter(page);
  await openCreate(page);
  await field(page, "title").fill("Two-day team preparation");
  await field(page, "allDay").check();
  await expect(field(page, "start")).toHaveAttribute("type", "date");
  await field(page, "start").fill("2026-10-28");
  await field(page, "end").fill("2026-10-29");
  await dialog(page, "create")
    .getByRole("button", { name: "Add calendar item", exact: true })
    .click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0].body).toMatchObject({
    allDay: true,
    startAt: Date.parse("2026-10-28T00:00:00Z"),
    endAt: Date.parse("2026-10-30T00:00:00Z"),
  });
  await page.keyboard.press("Escape");
  for (const day of ["2026-10-28", "2026-10-29"]) {
    await app(page).locator(`.day-number[data-day="${day}"]`).click();
    await expect(
      app(page).locator(".calendar-layout > .day-agenda"),
    ).toContainText("Two-day team preparation");
  }
  await app(page).locator('.day-number[data-day="2026-10-30"]').click();
  await expect(
    app(page).locator(".calendar-layout > .day-agenda"),
  ).not.toContainText("Two-day team preparation");
  await finish(page, fixture);
});

test("Calendar creation failure preserves entered draft and retries without duplicate concurrent posts", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.createFailures = 1;
  fixture.createStatus = 400;
  await openCreate(page);
  await field(page, "title").fill("Retry this team meeting");
  await field(page, "description").fill(
    "Keep this draft after the server returns an error.",
  );
  const submit = dialog(page, "create").getByRole("button", {
    name: "Add calendar item",
    exact: true,
  });
  await submit.click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await expect(field(page, "title")).toHaveValue("Retry this team meeting");
  await expect(field(page, "description")).toHaveValue(
    "Keep this draft after the server returns an error.",
  );
  await expect(dialog(page, "create")).toContainText(
    /could not|failed|unavailable/iu,
  );
  fixture.createDelay = 200;
  await submit.dblclick();
  await expect(dialog(page)).toContainText("Retry this team meeting");
  expect(fixture.writes).toHaveLength(2);
  await finish(page, fixture);
});

test("Calendar an uncertain save is checked before another POST and recovers the already saved item", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.createFailures = 1;
  fixture.createStatus = 503;
  fixture.persistBeforeCreateFailure = true;
  await openCreate(page);
  await field(page, "title").fill("Save result needs checking");
  const submit = dialog(page, "create").getByRole("button", {
    name: "Add calendar item",
    exact: true,
  });
  await submit.click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await expect(submit).toBeDisabled();
  await expect(field(page, "title")).toHaveValue("Save result needs checking");
  await expect(dialog(page, "create")).toContainText(
    /could not be confirmed/iu,
  );
  await action(page, "check-save").click();
  await expect(dialog(page)).toContainText("Save result needs checking");
  await expect(dialog(page)).toContainText(
    "A matching calendar item is visible",
  );
  expect(fixture.writes).toHaveLength(1);
  await finish(page, fixture);
});

test("Calendar revalidates a selected connected-calendar destination before posting", async ({
  page,
}) => {
  const fixture = await enter(page);
  await openCreate(page);
  await field(page, "title").fill("Destination permission changed");
  await dialog(page, "create").locator(".advanced-settings summary").click();
  await field(page, "writeTarget").check();
  fixture.connections = [];
  const submit = dialog(page, "create").getByRole("button", {
    name: "Add calendar item",
    exact: true,
  });
  await submit.click();
  await expect(dialog(page, "create")).toContainText(
    /no longer available|review.*destination/iu,
  );
  expect(fixture.writes).toHaveLength(0);
  await expect(submit).toBeEnabled();
  await expect(field(page, "title")).toHaveValue(
    "Destination permission changed",
  );
  await finish(page, fixture);
});

test("Calendar refresh failures recover without losing filters and Connections failure leaves the schedule available", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.itemFailures = 1;
  await action(page, "refresh").click();
  await expect(app(page)).toContainText(/unavailable|could not/iu);
  await action(page, "refresh").click();
  await ready(page);
  fixture.connectionFailures = 1;
  await action(page, "refresh").click();
  await expect(app(page).locator(".calendar-event")).not.toHaveCount(0);
  await action(page, "tab", '[data-tab="connections"]').click();
  await expect(app(page)).toContainText(
    /connection.*unavailable|could not.*connection|connections.*could not/iu,
  );
  await action(page, "tab", '[data-tab="schedule"]').click();
  await expect(app(page).locator(".month-grid")).toBeVisible();
  await finish(page, fixture);
});

test("Calendar members cannot create through an injected management action", async ({
  page,
}) => {
  const fixture = await enter(page, { role: "member" });
  await expect(action(page, "new-item", ":visible")).toHaveCount(0);
  await app(page).evaluate((root) =>
    root.insertAdjacentHTML(
      "beforeend",
      '<button type="button" data-cal-action="new-item" id="injected-calendar-create">Injected create</button>',
    ),
  );
  await page.locator("#injected-calendar-create").click();
  await expect(dialog(page, "create")).toHaveCount(0);
  expect(fixture.writes).toHaveLength(0);
  await finish(page, fixture);
});

test("Calendar missing permission is denied before private calendar requests", async ({
  page,
}) => {
  const fixture = await enter(page, { role: "denied" });
  await expect(
    page.getByText("This coalition access does not include Calendar.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(app(page).locator(".calendar-event")).toHaveCount(0);
  expect(
    fixture.requests.filter((row) => row.path.endsWith("/calendar/items")),
  ).toHaveLength(0);
  await finish(page, fixture);
});

for (const access of [
  { membershipStatus: "pending" },
  { omitMembership: true },
]) {
  test(`Calendar rejects ${access.omitMembership ? "public metadata without membership" : "pending membership"} before private requests`, async ({
    page,
  }) => {
    const fixture = await mockCalendarWorkspace(page, {
      role: "member",
      ...access,
    });
    await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
    await expect
      .poll(() =>
        fixture.requests.some((row) => row.path === `/api${COALITION_PATH}`),
      )
      .toBe(true);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await expect(
      page.locator('[data-cal-action="new-item"]:visible'),
    ).toHaveCount(0);
    expect(
      fixture.requests.filter((row) => row.path.endsWith("/calendar/items")),
    ).toHaveLength(0);
    await finish(page, fixture);
  });
}

test("Calendar keyboard date navigation and scoped handoffs retain organization navigation", async ({
  page,
}) => {
  const fixture = await enter(page);
  const date = app(page).locator('.day-number[data-day="2026-10-26"]');
  await date.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    app(page).locator('.day-number[data-day="2026-10-27"]'),
  ).toBeFocused();
  await expect(
    app(page).locator(".calendar-layout > .day-agenda"),
  ).toContainText("Volunteer office hours");
  await action(
    page,
    "destination",
    '[data-destination="Field events"]:visible',
  ).click();
  await expect(page).toHaveURL(
    new RegExp(`${COALITION_PATH}/calendar/field-events`, "u"),
  );
  await expect(page.locator(".coalition-ui-sidebar")).toContainText(
    "Cedar Valley Coalition",
  );
  await page.goBack();
  await ready(page);
  await action(
    page,
    "destination",
    '[data-destination="Transportation"]:visible',
  ).click();
  await expect(page).toHaveURL(
    new RegExp(`${COALITION_PATH}/calendar/field-events/transport`, "u"),
  );
  await expect(page.locator(".coalition-ui-sidebar")).toContainText(
    "Cedar Valley Coalition",
  );
  await finish(page, fixture);
});

test("Calendar overlap pagination follows an empty page and includes a cross-month item without a midnight phantom", async ({
  page,
}) => {
  const fixture = await mockCalendarWorkspace(page);
  const long = {
    ...fixture.items[0],
    calendarItemId: "cross-month",
    title: "Cross-month planning",
    startAt: Date.parse("2026-09-30T18:00:00Z"),
    endAt: Date.parse("2026-10-02T06:00:00Z"),
  };
  fixture.pages = [[], [long, ...fixture.items]];
  await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
  await ready(page);
  expect(
    fixture.requests.filter(
      (row) =>
        row.path.endsWith("/calendar/items") && row.query.includes("cursor="),
    ),
  ).toHaveLength(1);
  expect(
    fixture.requests
      .filter((row) => row.path.endsWith("/calendar/items"))
      .every((row) => row.query.includes("overlap=true")),
  ).toBe(true);
  await app(page).locator('.day-number[data-day="2026-10-01"]').click();
  await expect(
    app(page).locator(".calendar-layout > .day-agenda"),
  ).toContainText("Cross-month planning");
  await app(page).locator('.day-number[data-day="2026-10-02"]').click();
  await expect(
    app(page).locator(".calendar-layout > .day-agenda"),
  ).not.toContainText("Cross-month planning");
  await finish(page, fixture);
});

test("Calendar stale reads from a prior organization cannot replace the newly selected workspace", async ({
  page,
}) => {
  const fixture = await enter(page);
  let release;
  fixture.nextReadGate = new Promise((resolve) => {
    release = resolve;
  });
  const initialReads = fixture.requests.filter((row) =>
    row.path.endsWith("/calendar/items"),
  ).length;
  await action(page, "refresh").click();
  await expect
    .poll(
      () =>
        fixture.requests.filter((row) => row.path.endsWith("/calendar/items"))
          .length,
    )
    .toBeGreaterThan(initialReads);
  await page.evaluate(() => {
    history.pushState({}, "", "/coalitions/river-county/calendar");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".coalition-ui-sidebar")).toContainText(
    "River County Team",
  );
  release();
  await expect(app(page)).toContainText("River County meeting");
  await expect(app(page)).not.toContainText("North Cedar neighborhood canvass");
  await finish(page, fixture);
});

test("Calendar credential refresh rereads authorization and discards a draft belonging to the prior actor", async ({
  page,
}) => {
  const fixture = await enter(page);
  await openCreate(page);
  await field(page, "title").fill("Alex private draft");
  const reads = fixture.requests.filter((row) =>
    row.path.endsWith("/calendar/items"),
  ).length;
  fixture.actor = "riley";
  fixture.role = "member";
  await page.evaluate(() => {
    const key = "sharedFeedSession.v1",
      session = JSON.parse(sessionStorage.getItem(key));
    const token = `e30.${btoa(JSON.stringify({ sub: "riley", name: "Riley Chen", email: "riley@example.test" }))}.rotated`;
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...session, accessToken: token, idToken: token }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(
      () =>
        fixture.requests.filter((row) => row.path.endsWith("/calendar/items"))
          .length,
    )
    .toBeGreaterThan(reads);
  await expect(dialog(page, "create")).toHaveCount(0);
  await expect(app(page)).not.toContainText("Alex private draft");
  await expect(action(page, "new-item", ":visible")).toHaveCount(0);
  expect(fixture.writes).toHaveLength(0);
  await finish(page, fixture);
});

test("Calendar a completed write from the old actor cannot reopen their dialog after account change", async ({
  page,
}) => {
  const fixture = await enter(page);
  let release;
  fixture.nextWriteGate = new Promise((resolve) => {
    release = resolve;
  });
  await openCreate(page);
  await field(page, "title").fill("Old actor pending item");
  await dialog(page, "create")
    .getByRole("button", { name: "Add calendar item", exact: true })
    .click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  const reads = fixture.requests.filter((row) =>
    row.path.endsWith("/calendar/items"),
  ).length;
  fixture.actor = "riley";
  await page.evaluate(() => {
    const key = "sharedFeedSession.v1",
      session = JSON.parse(sessionStorage.getItem(key));
    const token = `e30.${btoa(JSON.stringify({ sub: "riley", name: "Riley Chen" }))}.rotated`;
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...session, accessToken: token, idToken: token }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(
      () =>
        fixture.requests.filter((row) => row.path.endsWith("/calendar/items"))
          .length,
    )
    .toBeGreaterThan(reads);
  await expect(dialog(page, "create")).toHaveCount(0);
  release();
  await page.waitForLoadState("networkidle");
  await expect(dialog(page)).toHaveCount(0);
  await expect(app(page)).not.toContainText("Old actor pending item");
  expect(fixture.writes).toHaveLength(1);
  await finish(page, fixture);
});

test("Calendar four-week February fits and Today returns to the current month", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const fixture = await mockCalendarWorkspace(page);
  fixture.items.push({
    ...fixture.items[0],
    calendarItemId: "february-meeting",
    title: "February planning",
    startAt: Date.parse("2027-02-14T19:00:00Z"),
    endAt: Date.parse("2027-02-14T20:00:00Z"),
  });
  await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
  await ready(page);
  for (let index = 0; index < 4; index++) await action(page, "next").click();
  await monthFits(page, 4);
  await expect(
    app(page).locator('.calendar-event[data-id="february-meeting"]'),
  ).toBeVisible();
  await action(page, "today").click();
  await monthFits(page, 5);
  await expect(
    app(page).locator('.day-number[data-day="2026-10-26"]'),
  ).toHaveAttribute("aria-current", "date");
  await finish(page, fixture);
});

for (const [role, width] of [
  ["admin", 1440],
  ["member", 390],
]) {
  test(`Calendar ${role} uses the approved light theme at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await enter(page, { role, theme: "light" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-polis-theme-resolved",
      "light",
    );
    expect(
      await app(page)
        .locator(".calendar-panel")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgb(255, 255, 255)");
    await monthFits(page, 5);
    await page.screenshot({
      path: testInfo.outputPath(`calendar-${role}-${width}-light.png`),
      animations: "disabled",
    });
    await finish(page, fixture);
  });
}

test("Calendar mobile Filters popover keeps a six-week month fitted and dismisses after selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const fixture = await enter(page, { role: "member" });
  await action(page, "next").click();
  await monthFits(page, 6);
  await action(page, "toggle-filters").click();
  await expect(action(page, "toggle-filters")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(app(page).locator("[data-cal-type]")).toBeVisible();
  await expect(app(page).locator("[data-cal-status]")).toBeVisible();
  await monthFits(page, 6);
  await app(page).locator("[data-cal-type]").selectOption("appointment");
  await expect(
    app(page).locator(".day-cell:not(.outside) .calendar-event"),
  ).toHaveCount(1);
  await app(page)
    .getByRole("heading", { name: "Calendar", exact: true })
    .click();
  await expect(action(page, "toggle-filters")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(app(page).locator("[data-cal-type]")).toBeHidden();
  await action(page, "clear-filters").first().click();
  await monthFits(page, 6);
  await finish(page, fixture);
});

test("Calendar connected-provider failures remain explicit in item details", async ({
  page,
}) => {
  const fixture = await mockCalendarWorkspace(page);
  Object.assign(
    fixture.items.find((item) => item.calendarItemId === "briefing"),
    {
      externalWriteTargets: [
        { provider: "google", calendarId: "coalition-events", mode: "write" },
      ],
      syncState: { providerWriteStatus: "partial_failure" },
    },
  );
  await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
  await ready(page);
  await app(page)
    .locator(
      '.calendar-layout > .day-agenda [data-cal-action="item"][data-id="briefing"]',
    )
    .click();
  await expect(dialog(page)).toContainText(
    /connected-calendar update needs attention/iu,
  );
  await finish(page, fixture);
});

test("Calendar service compatibility errors recover after the complete overlap contract becomes available", async ({
  page,
}) => {
  const fixture = await mockCalendarWorkspace(page);
  fixture.legacyList = true;
  await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
  await expect(app(page)).toContainText(/service is updating/iu);
  await expect(action(page, "new-item", ":visible")).toHaveCount(0);
  fixture.legacyList = false;
  await action(page, "refresh").click();
  await ready(page);
  await finish(page, fixture);
});

test("Calendar an exhausted read budget never claims an incompletely loaded calendar is empty", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await mockCalendarWorkspace(page);
  fixture.pages = Array.from({ length: 21 }, () => []);
  fixture.pageEvaluatedCount = 500;
  await page.goto(`${BASE_URL}${COALITION_PATH}/calendar`);
  await expect(app(page).locator(".calendar-limit-notice")).toBeVisible();
  await expect(app(page).locator(".calendar-limit-notice")).toContainText(
    /loading limit|incomplete/iu,
  );
  await expect(app(page)).not.toContainText("A clear calendar");
  await expect(app(page).locator("#result-count")).toContainText(/loaded/iu);
  await monthFits(page, 5);
  const rail = app(page).locator(".calendar-layout > .day-agenda");
  await expect(rail).toContainText(/incomplete|may be missing|not complete/iu);
  await expect(rail).not.toContainText("Nothing scheduled");
  const reads = fixture.requests.filter((row) =>
    row.path.endsWith("/calendar/items"),
  );
  const cursors = new Set(
    reads.map(
      (row) => new URLSearchParams(row.query).get("cursor") || "page:0",
    ),
  );
  expect(cursors.size).toBe(20);
  expect(cursors.has("page:19")).toBe(true);
  expect(cursors.has("page:20")).toBe(false);
  await finish(page, fixture);
});

function coversSubmittedInterval(requests, body) {
  return requests.some((row) => {
    if (row.method !== "GET" || !row.path.endsWith("/calendar/items"))
      return false;
    const query = new URLSearchParams(row.query);
    const parse = (name) =>
      /^\d+$/u.test(query.get(name) || "")
        ? Number(query.get(name))
        : Date.parse(query.get(name));
    return (
      query.get("overlap") === "true" &&
      parse("from") <= body.startAt &&
      parse("to") >= body.endAt
    );
  });
}

test("Calendar successful future month and week saves reload the complete destination schedule", async ({
  page,
}) => {
  const fixture = await enter(page);
  const periods = [
    {
      view: "month",
      day: "2026-12-10",
      title: "December planning",
      existing: "Existing December meeting",
    },
    {
      view: "week",
      day: "2027-02-14",
      title: "February planning",
      existing: "Existing February meeting",
    },
  ];
  for (const period of periods) {
    fixture.items.push({
      ...fixture.items[0],
      calendarItemId: `existing-${period.day}`,
      title: period.existing,
      startAt: Date.parse(`${period.day}T18:00:00Z`),
      endAt: Date.parse(`${period.day}T19:00:00Z`),
      startAtIso: `${period.day}T18:00:00.000Z`,
      endAtIso: `${period.day}T19:00:00.000Z`,
    });
    if (period.view === "week") await view(page, "week");
    await openCreate(page);
    await field(page, "title").fill(period.title);
    await field(page, "start").fill(`${period.day}T11:30`);
    await field(page, "end").fill(`${period.day}T12:30`);
    const readOffset = fixture.requests.length,
      writeOffset = fixture.writes.length;
    if (period.view === "month") fixture.omitCreatedFromReads = 1;
    await dialog(page, "create")
      .getByRole("button", { name: "Add calendar item", exact: true })
      .click();
    await expect.poll(() => fixture.writes.length).toBe(writeOffset + 1);
    const body = fixture.writes.at(-1).body;
    expect(body.startAt).toBe(Date.parse(`${period.day}T18:30:00Z`));
    expect(body.endAt).toBe(Date.parse(`${period.day}T19:30:00Z`));
    await expect
      .poll(() =>
        coversSubmittedInterval(fixture.requests.slice(readOffset), body),
      )
      .toBe(true);
    await expect(dialog(page)).toContainText(period.title);
    if (period.view === "month")
      expect(
        fixture.requests
          .slice(readOffset)
          .some((row) => row.omittedCreatedIds?.includes("created-1")),
      ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(app(page)).toContainText(period.existing);
    await expect(app(page)).toContainText(period.title);
    if (period.view === "month") {
      await app(page).locator(`.day-number[data-day="${period.day}"]`).click();
      const rail = app(page).locator(".calendar-layout > .day-agenda");
      await expect(rail).toContainText(period.existing);
      await expect(rail).toContainText(period.title);
      await expect(rail.locator(".overlap-note")).toBeVisible();
    } else {
      await expect(app(page).locator(".week-grid")).toContainText(
        period.existing,
      );
      await expect(app(page).locator(".week-grid")).toContainText(period.title);
    }
  }
  expect(fixture.writes).toHaveLength(2);
  await finish(page, fixture);
});

test("Calendar uncertain future multi-day saves reconcile their complete submitted interval without a duplicate POST", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.createFailures = 1;
  fixture.createStatus = 503;
  fixture.persistBeforeCreateFailure = true;
  await openCreate(page);
  await field(page, "title").fill("Future multi-day save check");
  await field(page, "allDay").check();
  await field(page, "start").fill("2026-12-10");
  await field(page, "end").fill("2027-02-12");
  await dialog(page, "create")
    .getByRole("button", { name: "Add calendar item", exact: true })
    .click();
  await expect(action(page, "check-save")).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
  const body = fixture.writes[0].body,
    readOffset = fixture.requests.length;
  expect(body.endAt).toBe(Date.parse("2027-02-13T00:00:00Z"));
  await action(page, "check-save").click();
  await expect
    .poll(() =>
      coversSubmittedInterval(fixture.requests.slice(readOffset), body),
    )
    .toBe(true);
  await expect(dialog(page)).toContainText("Future multi-day save check");
  await expect(dialog(page)).toContainText(
    "A matching calendar item is visible",
  );
  await expect(dialog(page, "create")).toHaveCount(0);
  expect(fixture.writes).toHaveLength(1);
  await finish(page, fixture);
});

test("Calendar late reconciliation from a previous actor cannot change the current actor's new draft", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.createFailures = 1;
  fixture.createStatus = 503;
  fixture.persistBeforeCreateFailure = true;
  await openCreate(page);
  await field(page, "title").fill("Alex uncertain future item");
  await field(page, "start").fill("2026-12-10T11:30");
  await field(page, "end").fill("2026-12-10T12:30");
  await dialog(page, "create")
    .getByRole("button", { name: "Add calendar item", exact: true })
    .click();
  await expect(action(page, "check-save")).toBeVisible();
  let release;
  fixture.nextReadGate = new Promise((resolve) => {
    release = resolve;
  });
  const reads = fixture.requests.filter((row) =>
    row.path.endsWith("/calendar/items"),
  ).length;
  await action(page, "check-save").click();
  await expect
    .poll(
      () =>
        fixture.requests.filter((row) => row.path.endsWith("/calendar/items"))
          .length,
    )
    .toBeGreaterThan(reads);
  fixture.actor = "riley";
  await page.evaluate(() => {
    const key = "sharedFeedSession.v1",
      session = JSON.parse(sessionStorage.getItem(key));
    const token = `e30.${btoa(JSON.stringify({ sub: "riley", name: "Riley Chen" }))}.rotated`;
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...session, accessToken: token, idToken: token }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(
      () =>
        fixture.requests.filter((row) => row.path.endsWith("/calendar/items"))
          .length,
    )
    .toBeGreaterThan(reads + 1);
  await expect(dialog(page, "create")).toHaveCount(0);
  await openCreate(page);
  await field(page, "title").fill("Riley current draft");
  release();
  await page.waitForLoadState("networkidle");
  await expect(field(page, "title")).toHaveValue("Riley current draft");
  await expect(dialog(page, "create").locator("#form-error")).toBeHidden();
  await expect(dialog(page)).toHaveCount(0);
  await expect(app(page)).not.toContainText("Alex uncertain future item");
  expect(fixture.writes).toHaveLength(1);
  await finish(page, fixture);
});
