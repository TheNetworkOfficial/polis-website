const { test, expect } = require("@playwright/test");
const {
  BASE_URL,
  ADMIN_PATH,
  COALITION_PATH,
  COALITION_ID,
  FIXED_TIME,
  IMAGE_URL,
  mockAdministrationWorkspace,
  rotateSession,
} = require("./fixtures/administration-workspace.cjs");

const app = (page) => page.locator(".coalition-administration-page");
const action = (page, name, suffix = "") =>
  app(page).locator(`[data-admin-action="${name}"]${suffix}`);
const field = (page, name) => app(page).locator(`[name="${name}"]`);
const dialog = (page) => app(page).locator("#detail-dialog[open]");
const profileWrites = (fixture) =>
  fixture.writes.filter((row) => row.method === "PATCH");
const scriptWrites = (fixture) =>
  fixture.writes.filter((row) => row.method === "PUT");
const fixtures = new WeakMap();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBK8AAAAASUVORK5CYII=",
  "base64",
);
const file = { name: "organization.png", mimeType: "image/png", buffer: png };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

async function enter(page, options = {}) {
  const fixture = await mockAdministrationWorkspace(page, options);
  fixtures.set(page, fixture);
  await page.goto(`${BASE_URL}${options.path || ADMIN_PATH}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(app(page)).toBeVisible();
  await expect(app(page)).not.toHaveAttribute(
    "data-admin-condition",
    "loading",
  );
  if (!options.restricted) {
    await expect(app(page)).toHaveAttribute("data-admin-condition", "ready");
    if ((options.path || "").endsWith("/outreach"))
      await expect(field(page, "scriptTitle")).toBeVisible();
    else await expect(field(page, "name")).toBeVisible();
  }
  return fixture;
}

async function tab(page, name) {
  await action(page, "tab", `[data-tab="${name}"]`).click();
  await expect(action(page, "tab", `[data-tab="${name}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    field(page, name === "profile" ? "name" : "scriptTitle"),
  ).toBeVisible();
}

async function channel(page, name) {
  await action(page, "channel", `[data-channel="${name}"]`).click();
  await expect(
    action(page, "channel", `[data-channel="${name}"]`),
  ).toHaveAttribute("aria-pressed", "true");
}

async function save(page) {
  await action(page, "save").click();
  await expect(app(page)).toHaveAttribute("data-admin-operation", "");
}

async function saved(page) {
  await expect(app(page).locator("#save-state")).toHaveText("Saved just now");
  await expect(action(page, "save")).toBeDisabled();
}

async function imageUrl(page, value) {
  await action(page, "image-url").click();
  await field(page, "hostedImageUrl").fill(value);
  await action(page, "apply-image-url").click();
}

async function allSocials(page) {
  await app(page).locator(".social-details summary").click();
}

async function upload(page, value = file) {
  await app(page).locator("#organization-image").setInputFiles(value);
  await expect(app(page)).toHaveAttribute("data-admin-operation", "");
}

test.afterEach(async ({ page }, testInfo) => {
  const fixture = fixtures.get(page);
  if (!fixture) return;
  await testInfo.attach("administration-network.json", {
    body: JSON.stringify(
      {
        requests: fixture.requests,
        writes: fixture.writes,
        profileApplications: fixture.profileApplications,
        scriptApplications: fixture.scriptApplications,
        uploadBytes: fixture.uploadBytes,
        authRequests: fixture.authRequests,
        unexpectedWrites: fixture.unexpectedWrites,
        blockedExternalRequests: fixture.blockedExternalRequests,
        externalFixtureRequests: fixture.externalFixtureRequests,
        runtimeAssetResponses: fixture.runtimeAssetResponses,
        errors: fixture.errors,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
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
  for (const bytes of fixture.uploadBytes) {
    expect(bytes.headers.authorization).toBeUndefined();
    expect(bytes.headers["x-polis-expected-actor"]).toBeUndefined();
    expect(bytes.headers.cookie).toBeUndefined();
    expect(bytes.headers.referer).toBeUndefined();
    expect(bytes.contentType).toMatch(/^multipart\/form-data; boundary=/u);
    expect(bytes.bytes).toBeGreaterThan(png.length);
  }
});

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  for (const theme of ["dark", "light"]) {
    test(`approved Administration layout ${viewport.width}x${viewport.height} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const fixture = await enter(page, { theme });
      const profileGeometry = await geometry(page);
      expect(profileGeometry.scrollWidth).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      expect(profileGeometry.fontFamily).toContain("Inter");
      await expect(
        app(page).locator(
          "#profile-form input, #profile-form textarea, #profile-form select",
        ),
      ).toHaveCount(15);
      await expect(
        app(page).getByText(
          /Invite people|Pending requests|Total members|Create room/u,
        ),
      ).toHaveCount(0);
      await expect(
        app(page).locator("[data-admin-action='save']"),
      ).toBeDisabled();
      await testInfo.attach(`profile-${viewport.width}-${theme}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      await allSocials(page);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const sticky = await geometry(page);
      expect(sticky.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
      expect(sticky.toolbar.y).toBeGreaterThanOrEqual(-1);
      expect(sticky.toolbar.bottom).toBeLessThan(viewport.height);
      if (viewport.width < 700) {
        const menu = app(page).locator("[data-admin-mobile-nav] summary");
        await expect(menu).toBeInViewport();
        await menu.click();
        await expect(
          app(page).locator("[data-admin-mobile-nav] [data-route]").first(),
        ).toBeInViewport();
        await menu.click();
      } else {
        expect(sticky.sidebar.y).toBeCloseTo(profileGeometry.sidebar.y, 0);
        expect(sticky.sidebar.bottom).toBeLessThanOrEqual(viewport.height + 1);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await tab(page, "outreach");
      const outreachGeometry = await geometry(page);
      expect(outreachGeometry.scrollWidth).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      await expect(action(page, "channel")).toHaveCount(4);
      await testInfo.attach(`outreach-${viewport.width}-${theme}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      await testInfo.attach(`geometry-${viewport.width}-${theme}.json`, {
        body: JSON.stringify(
          {
            viewport,
            theme,
            profile: profileGeometry,
            expandedProfile: sticky,
            outreach: outreachGeometry,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(fixture.writes).toEqual([]);
    });
  }
}

async function geometry(page) {
  return app(page).evaluate((root) => {
    const rect = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
        fontFamily: css.fontFamily,
        fontSize: css.fontSize,
        lineHeight: css.lineHeight,
        padding: css.padding,
        gap: css.gap,
        backgroundColor: css.backgroundColor,
        borderRadius: css.borderRadius,
      };
    };
    return {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      fontFamily: getComputedStyle(root).fontFamily,
      root: rect(root),
      toolbar: rect(root.querySelector(".admin-toolbar")),
      heading: rect(root.querySelector(".page-heading")),
      tabs: rect(root.querySelector(".admin-tab-row")),
      profileGrid: rect(root.querySelector(".admin-profile-grid")),
      panels: [...root.querySelectorAll(".panel")].map(rect),
      inputs: [
        ...root.querySelectorAll("input:not([hidden]),textarea,select"),
      ].map(rect),
      outreach: rect(root.querySelector(".outreach-layout")),
      channels: rect(root.querySelector(".script-channels")),
      editor: rect(root.querySelector(".script-editor-layout")),
      sidebar: rect(document.querySelector(".coalition-ui-sidebar")),
      topbar: rect(document.querySelector(".coalition-ui-topbar")),
    };
  });
}

test("complete profile writes all identity, contact, PAC, social fields and visible saved name", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Cedar Valley United");
  await field(page, "coalitionType").selectOption("constitutional");
  await field(page, "description").fill("Working together for Cedar Valley.");
  await field(page, "primaryContactName").fill("Casey Hill");
  await field(page, "email").fill("casey@cedarvalley.example");
  await field(page, "phone").fill("(406) 555-0199");
  await field(page, "website").fill("https://united.example");
  await imageUrl(
    page,
    "https://imagedelivery.net/fixture-account/updated/public",
  );
  await app(page).locator(".pac-details summary").click();
  await field(page, "pacAssociated").check();
  await field(page, "fecNumber").fill("C00999999");
  await allSocials(page);
  for (const key of ["facebook", "threads", "bluesky", "instagram", "tiktok"])
    await field(page, key).fill(`https://${key}.example/cedar`);
  await save(page);
  await saved(page);
  expect(profileWrites(fixture)).toHaveLength(1);
  const body = profileWrites(fixture)[0].body;
  expect(body).toMatchObject({
    name: "Cedar Valley United",
    coalitionType: "constitutional",
    description: "Working together for Cedar Valley.",
    imageUrl: "https://imagedelivery.net/fixture-account/updated/public",
    primaryContactName: "Casey Hill",
    email: "casey@cedarvalley.example",
    phone: "(406) 555-0199",
    website: "https://united.example/",
    pacAssociated: true,
    fecNumber: "C00999999",
    expectedRevision: 1,
  });
  expect(body.clientRequestId).toMatch(/^[\da-f-]{36}$/u);
  expect(Object.keys(body.socials)).toEqual([
    "facebook",
    "threads",
    "bluesky",
    "instagram",
    "tiktok",
  ]);
  await expect(page.locator(".coalition-ui-sidebar")).toContainText(
    "Cedar Valley United",
  );
  await action(page, "preview-profile").click();
  await expect(dialog(page)).toContainText("Cedar Valley United");
  await expect(dialog(page)).toContainText("Casey Hill");
  await expect(dialog(page)).not.toContainText(/verified/iu);
});

test("required profile fields and conditional FEC block incomplete writes", async ({
  page,
}) => {
  const fixture = await enter(page, { emptyProfile: true });
  await field(page, "name").fill("New organization");
  await save(page);
  for (const key of ["description", "primaryContactName", "email", "phone"])
    await expect(app(page).locator(`#error-${key}`)).toBeVisible();
  await expect(app(page).locator("#error-imageUrl")).toBeVisible();
  expect(profileWrites(fixture)).toEqual([]);
  await field(page, "description").fill("A complete description.");
  await field(page, "primaryContactName").fill("Jordan Lee");
  await field(page, "email").fill("hello@example.test");
  await field(page, "phone").fill("555-0100");
  await imageUrl(page, IMAGE_URL);
  await app(page).locator(".pac-details summary").click();
  await field(page, "pacAssociated").check();
  await save(page);
  await expect(app(page).locator("#error-fecNumber")).toBeVisible();
  expect(profileWrites(fixture)).toEqual([]);
  await field(page, "pacAssociated").uncheck();
  await save(page);
  await saved(page);
  expect(fixture.profiles[COALITION_ID].fecNumber).toBeNull();
});

test("malformed URLs and email show errors and unsafe image URLs never render", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "email").fill("invalid");
  await field(page, "website").fill("javascript:alert(1)");
  await allSocials(page);
  await field(page, "instagram").fill("file:///C:/secrets");
  await imageUrl(page, "javascript:alert(1)");
  await expect(dialog(page).locator("#image-url-error")).toBeVisible();
  await action(page, "close-dialog").first().click();
  await save(page);
  for (const key of ["email", "website", "instagram"])
    await expect(app(page).locator(`#error-${key}`)).toBeVisible();
  expect(profileWrites(fixture)).toEqual([]);
  await expect(app(page).locator("img[src^='javascript:']")).toHaveCount(0);
});

test("Profile and Outreach keep independent drafts and explicit reload discards only its section", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Unsaved profile");
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Unsaved call");
  await action(page, "refresh-scripts").click();
  await expect(dialog(page)).toContainText("Reload saved templates?");
  await action(page, "close-dialog").first().click();
  await expect(field(page, "scriptTitle")).toHaveValue("Unsaved call");
  await action(page, "refresh-scripts").click();
  await action(page, "confirm-action").click();
  await expect(field(page, "scriptTitle")).toHaveValue(
    "Community conversation",
  );
  await tab(page, "profile");
  await expect(field(page, "name")).toHaveValue("Unsaved profile");
  expect(fixture.writes).toEqual([]);
});

test("definite profile validation failure keeps editable draft and allows deliberate retry", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.profileWriteFailures = 1;
  fixture.profileWriteStatus = 400;
  await field(page, "name").fill("Retry profile");
  await save(page);
  await expect(app(page).locator("[role='alert']")).toContainText(
    "profile_temporarily_unavailable",
  );
  await expect(field(page, "name")).toHaveValue("Retry profile");
  await expect(field(page, "name")).toBeEnabled();
  await save(page);
  await saved(page);
  expect(profileWrites(fixture)).toHaveLength(2);
  expect(fixture.profileApplications).toHaveLength(1);
});

test("duplicate organization name is a field error and preserves the rest of the draft", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.nameConflict = true;
  await field(page, "name").fill("Existing organization");
  await field(page, "description").fill("Keep this description.");
  await save(page);
  await expect(app(page).locator("#error-name")).toBeVisible();
  await expect(field(page, "description")).toHaveValue(
    "Keep this description.",
  );
  await expect(action(page, "reload-current")).toHaveCount(0);
  expect(fixture.profileApplications).toEqual([]);
});

test("changed saved revision preserves local profile and asks before reloading the latest profile", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("My profile draft");
  fixture.profiles[COALITION_ID].name = "Another admin's name";
  fixture.profiles[COALITION_ID].organizationMutationRevision++;
  await save(page);
  await expect(app(page).locator("[role='alert']")).toContainText(
    "updated elsewhere",
  );
  expect(profileWrites(fixture)).toEqual([]);
  await expect(field(page, "name")).toHaveValue("My profile draft");
  await action(page, "reload-current").click();
  await action(page, "close-dialog").first().click();
  await expect(field(page, "name")).toHaveValue("My profile draft");
  await action(page, "reload-current").click();
  await action(page, "confirm-action").click();
  await expect(field(page, "name")).toHaveValue("Another admin's name");
});

for (const persisted of [true, false]) {
  test(`uncertain profile save ${persisted ? "with" : "without"} persisted data uses read-only checking`, async ({
    page,
  }) => {
    const fixture = await enter(page);
    fixture.profileWriteFailures = 1;
    fixture.persistProfileBeforeFailure = persisted;
    await field(page, "name").fill("Interrupted profile");
    await save(page);
    await expect(app(page).locator("[role='alert']")).toContainText(
      "save could not be confirmed",
    );
    await expect(action(page, "save")).toBeDisabled();
    await expect(field(page, "name")).toHaveValue("Interrupted profile");
    const writesBefore = fixture.writes.length;
    await action(page, "check-save").click();
    await expect(app(page)).toHaveAttribute("data-admin-operation", "");
    expect(fixture.writes).toHaveLength(writesBefore);
    if (persisted) {
      await expect(app(page).locator("#save-state")).toHaveText(
        "Saved details checked",
      );
      await expect(app(page)).toContainText("saved details match your changes");
      await expect(field(page, "name")).toBeEnabled();
    } else {
      await expect(app(page).locator("#save-state")).toHaveText(
        "Save needs checking",
      );
      await expect(action(page, "save")).toBeDisabled();
      await expect(field(page, "name")).toBeDisabled();
      await tab(page, "outreach");
      await field(page, "scriptTitle").fill("Independent outreach draft");
      await save(page);
      await saved(page);
      await tab(page, "profile");
      await expect(app(page).locator("#save-state")).toHaveText(
        "Save needs checking",
      );
      await expect(field(page, "name")).toHaveValue("Interrupted profile");
      await expect(field(page, "name")).toBeDisabled();
    }
    expect(profileWrites(fixture)).toHaveLength(1);
  });
}

test("all four outreach channels preview merge fields, retain partial drafts, enforce limits and save together", async ({
  page,
}) => {
  const fixture = await enter(page);
  await tab(page, "outreach");
  for (const [key, title, body] of [
    [
      "phoneCall",
      "Call update",
      "Hi {{firstName}} — {{volunteerName}} from {{campaignName}}.",
    ],
    ["textMessage", "Text update", "Hello {{firstName}}"],
    ["mailEmail", "Email update", ""],
    [
      "mailPhysical",
      "Postal update",
      "Dear {{firstName}} from {{campaignName}}",
    ],
  ]) {
    await channel(page, key);
    await field(page, "scriptTitle").fill(title);
    await field(page, "scriptBody").fill(body);
    await expect(field(page, "scriptTitle")).toHaveAttribute(
      "maxlength",
      "120",
    );
    await expect(field(page, "scriptBody")).toHaveAttribute(
      "maxlength",
      "5000",
    );
    if (key === "mailEmail")
      await expect(
        app(page).locator(`[data-channel-status="${key}"]`),
      ).toHaveText("Draft");
    if (key === "mailPhysical")
      await expect(
        action(page, "insert-token", '[data-token="volunteerName"]'),
      ).toHaveCount(0);
  }
  await expect(app(page).locator("[data-script-preview]")).toContainText(
    "Dear Casey from Cedar Valley Coalition",
  );
  await channel(page, "phoneCall");
  await expect(app(page).locator("[data-script-preview]")).toContainText(
    "Jordan",
  );
  await field(page, "scriptBody").fill("Hi ");
  await field(page, "scriptBody").focus();
  await field(page, "scriptBody").press("End");
  await action(page, "insert-token", '[data-token="firstName"]').click();
  await expect(field(page, "scriptBody")).toHaveValue("Hi {{firstName}}");
  await field(page, "scriptTitle").fill("T".repeat(120));
  await field(page, "scriptBody").fill("B".repeat(5000));
  await action(page, "insert-token", '[data-token="firstName"]').click();
  await expect(field(page, "scriptBody")).toHaveValue("B".repeat(5000));
  await expect(app(page).locator("[data-title-count]")).toHaveText("120 / 120");
  await expect(app(page).locator("[data-body-count]")).toHaveText(
    "5000 / 5,000",
  );
  await save(page);
  await saved(page);
  expect(scriptWrites(fixture)).toHaveLength(1);
  const templates = scriptWrites(fixture)[0].body.templates;
  expect(Object.keys(templates)).toEqual([
    "phoneCall",
    "textMessage",
    "mailEmail",
    "mailPhysical",
  ]);
  expect(templates.mailEmail).toEqual({ title: "Email update", body: "" });
  expect(
    fixture.writes.every((row) => /outreach-templates$/u.test(row.path)),
  ).toBe(true);
});

test("definite outreach save failure preserves the current channel and all drafts", async ({
  page,
}) => {
  const fixture = await enter(page);
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Retain call");
  await channel(page, "textMessage");
  await field(page, "scriptBody").fill("Retain text");
  fixture.scriptWriteFailures = 1;
  fixture.scriptWriteStatus = 400;
  await save(page);
  await expect(field(page, "scriptBody")).toHaveValue("Retain text");
  await expect(field(page, "scriptBody")).toBeEnabled();
  await channel(page, "phoneCall");
  await expect(field(page, "scriptTitle")).toHaveValue("Retain call");
  await save(page);
  await saved(page);
  expect(fixture.scriptApplications).toHaveLength(1);
});

test("outreach conflict preserves local changes and never overwrites changed shared copy", async ({
  page,
}) => {
  const fixture = await enter(page);
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Local call draft");
  fixture.templates[COALITION_ID].phoneCall.title = "Shared copy changed";
  await save(page);
  await expect(app(page).locator("[role='alert']")).toContainText(
    "updated elsewhere",
  );
  await expect(field(page, "scriptTitle")).toHaveValue("Local call draft");
  expect(scriptWrites(fixture)).toEqual([]);
  await action(page, "reload-current").click();
  await action(page, "confirm-action").click();
  await expect(field(page, "scriptTitle")).toHaveValue("Shared copy changed");
});

for (const persisted of [true, false]) {
  test(`uncertain outreach save ${persisted ? "with" : "without"} persisted data cannot resend automatically`, async ({
    page,
  }) => {
    const fixture = await enter(page);
    await tab(page, "outreach");
    fixture.scriptWriteFailures = 1;
    fixture.persistScriptsBeforeFailure = persisted;
    await field(page, "scriptTitle").fill("Interrupted outreach");
    await save(page);
    await expect(action(page, "save")).toBeDisabled();
    await expect(field(page, "scriptTitle")).toHaveValue(
      "Interrupted outreach",
    );
    await action(page, "check-save").click();
    await expect(app(page)).toHaveAttribute("data-admin-operation", "");
    expect(scriptWrites(fixture)).toHaveLength(1);
    if (persisted) {
      await expect(app(page).locator("#save-state")).toHaveText(
        "Saved details checked",
      );
      await expect(field(page, "scriptTitle")).toBeEnabled();
    } else {
      await expect(app(page).locator("#save-state")).toHaveText(
        "Save needs checking",
      );
      await expect(field(page, "scriptTitle")).toBeDisabled();
      await tab(page, "profile");
      await field(page, "name").fill("Independent profile draft");
      await save(page);
      await saved(page);
      await tab(page, "outreach");
      await expect(app(page).locator("#save-state")).toHaveText(
        "Save needs checking",
      );
      await expect(field(page, "scriptTitle")).toHaveValue(
        "Interrupted outreach",
      );
      await expect(field(page, "scriptTitle")).toBeDisabled();
    }
  });
}

test("genuinely empty organization and templates keep usable profile forms and four draft channels", async ({
  page,
}) => {
  const fixture = await enter(page, {
    emptyProfile: true,
    emptyTemplates: true,
  });
  await expect(field(page, "name")).toHaveValue("");
  await expect(action(page, "choose-image")).toBeEnabled();
  await tab(page, "outreach");
  for (const key of ["phoneCall", "textMessage", "mailEmail", "mailPhysical"]) {
    await channel(page, key);
    await expect(field(page, "scriptTitle")).toHaveValue("");
    await expect(field(page, "scriptBody")).toHaveValue("");
    await expect(
      app(page).locator(`[data-channel-status="${key}"]`),
    ).toHaveText("Draft");
  }
  await field(page, "scriptTitle").fill("A title-only draft");
  await save(page);
  await saved(page);
  expect(Object.keys(scriptWrites(fixture)[0].body.templates)).toEqual([
    "phoneCall",
    "textMessage",
    "mailEmail",
    "mailPhysical",
  ]);
  expect(fixture.templates[COALITION_ID]).toEqual({
    mailPhysical: { title: "A title-only draft", body: "" },
  });
});

test("profile editor can save the organization and reads outreach without editing it", async ({
  page,
}) => {
  const fixture = await enter(page, { role: "editor" });
  await expect(app(page).locator("#role-label")).toHaveText("Profile editor");
  await field(page, "name").fill("Editor update");
  await save(page);
  await saved(page);
  await tab(page, "outreach");
  await expect(field(page, "scriptTitle")).toBeDisabled();
  await expect(action(page, "save")).toBeHidden();
  expect(profileWrites(fixture)).toHaveLength(1);
});

test("custom Staff lead sees organization and shared templates with read-only controls", async ({
  page,
}) => {
  const fixture = await enter(page, { role: "leader" });
  await expect(app(page).locator("#role-label")).toHaveText("Staff lead");
  await expect(field(page, "name")).toBeDisabled();
  await expect(action(page, "save")).toBeHidden();
  await tab(page, "outreach");
  await expect(field(page, "scriptBody")).toBeDisabled();
  expect(fixture.writes).toEqual([]);
});

test("ordinary member cannot manage Profile but can read qualified outreach", async ({
  page,
}) => {
  const fixture = await enter(page, { role: "member", restricted: true });
  await expect(app(page)).toContainText("Administration access required");
  await expect(app(page).locator("#profile-form")).toHaveCount(0);
  await expect(action(page, "save")).toBeHidden();
  await action(page, "tab", '[data-tab="outreach"]').click();
  await expect(field(page, "scriptBody")).toBeDisabled();
  expect(fixture.writes).toEqual([]);
});

for (const status of ["inactive", "pending", "missing"]) {
  test(`${status} membership cannot reveal editable organization details`, async ({
    page,
  }) => {
    const fixture = await enter(page, {
      membershipStatus: status === "missing" ? "active" : status,
      omitMembership: status === "missing",
      restricted: true,
    });
    await expect(app(page)).toContainText("Administration access required");
    await expect(app(page).locator("#profile-form")).toHaveCount(0);
    await expect(action(page, "save")).toBeHidden();
    expect(fixture.writes).toEqual([]);
  });
}

test("fresh profile permission revocation blocks a stale administrator's save", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Should not save");
  fixture.role = "member";
  await save(page);
  await expect(app(page)).toContainText("Administration access required");
  expect(profileWrites(fixture)).toEqual([]);
});

test("fresh outreach permission revocation blocks saved templates before PUT", async ({
  page,
}) => {
  const fixture = await enter(page);
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Should not save");
  fixture.role = "leader";
  await save(page);
  await expect(field(page, "scriptTitle")).toBeDisabled();
  expect(scriptWrites(fixture)).toEqual([]);
});

test("late read from the previous organization cannot populate the current organization", async ({
  page,
}) => {
  const fixture = await enter(page);
  const gate = deferred();
  fixture.nextScriptReadGate = gate.promise;
  await action(page, "tab", '[data-tab="outreach"]').click();
  await expect(app(page)).toContainText("Loading outreach templates");
  await page.evaluate(() => {
    history.pushState({}, "", "/coalitions/river-county/admin/edit");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(field(page, "name")).toHaveValue("River County Team");
  gate.resolve();
  await expect(field(page, "name")).toHaveValue("River County Team");
  await expect(app(page).locator("#profile-form")).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test("late save response for the previous actor cannot expose that actor's profile to a new member", async ({
  page,
}) => {
  const fixture = await enter(page);
  const gate = deferred();
  fixture.nextProfileWriteGate = gate.promise;
  await field(page, "name").fill("Alex private draft");
  await action(page, "save").click();
  await expect.poll(() => profileWrites(fixture).length).toBe(1);
  await rotateSession(page, fixture);
  await expect(app(page)).toContainText("Administration access required");
  gate.resolve();
  await expect(app(page)).not.toContainText("Alex private draft");
  await expect(app(page).locator("#profile-form")).toHaveCount(0);
  expect(fixture.profileApplications.every((row) => row.actor === "alex")).toBe(
    true,
  );
});

test("expired same-actor session renews during one save without dropping its draft", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Renewed session profile");
  await page.clock.setFixedTime(FIXED_TIME + 3600000 + 1000);
  await save(page);
  await saved(page);
  expect(fixture.authRequests).toHaveLength(1);
  expect(profileWrites(fixture)).toHaveLength(1);
  expect(profileWrites(fixture)[0].body.name).toBe("Renewed session profile");
  const credential = JSON.parse(
    Buffer.from(
      profileWrites(fixture)[0]
        .headers.authorization.split(" ")[1]
        .split(".")[1],
      "base64url",
    ).toString(),
  );
  expect(credential.credentialVersion).toBe("renewed");
});

test("renewal returning a different actor rejects the write and does not reuse prior authority", async ({
  page,
}) => {
  const fixture = await enter(page);
  fixture.refreshActor = "riley";
  await field(page, "name").fill("Wrong actor cannot save");
  await page.clock.setFixedTime(FIXED_TIME + 3600000 + 1000);
  await action(page, "save").click();
  await expect.poll(() => fixture.authRequests.length).toBe(1);
  expect(profileWrites(fixture)).toEqual([]);
  await expect(app(page).locator("#profile-form")).toHaveCount(0);
  const retained = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("sharedFeedSession.v1")),
  );
  if (retained?.idToken) {
    const storedClaims = JSON.parse(
      Buffer.from(retained.idToken.split(".")[1], "base64url").toString(),
    );
    expect(storedClaims.sub).toBe("alex");
    expect(storedClaims.credentialVersion).toBe("original");
  }
  expect(fixture.requests.filter((row) => row.actor === "riley")).toEqual([]);
});

test("CF multipart upload stages the returned image and profile save explicitly applies it", async ({
  page,
}) => {
  const fixture = await enter(page);
  for (const invalid of [
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Not an image"),
    },
    {
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
    },
  ]) {
    await upload(page, invalid);
    await expect(app(page).locator(".form-error[role='alert']")).toBeVisible();
    expect(
      fixture.writes.filter((row) => row.path === "/api/uploads/create"),
    ).toEqual([]);
    await expect(app(page).locator(".logo-preview img")).toHaveAttribute(
      "src",
      IMAGE_URL,
    );
  }
  await upload(page);
  await expect(app(page).locator(".logo-preview img")).toHaveAttribute(
    "src",
    /fixture-image-1\/public$/u,
  );
  expect(fixture.uploadBytes).toHaveLength(1);
  expect(profileWrites(fixture)).toEqual([]);
  expect(
    fixture.writes.find((row) => row.path === "/api/uploads/create").body,
  ).toEqual({
    type: "image",
    fileName: file.name,
    fileSize: png.length,
    contentType: "image/png",
  });
  await save(page);
  await saved(page);
  expect(profileWrites(fixture)[0].body.imageUrl).toBe(
    "https://imagedelivery.net/fixture-account/fixture-image-1/public",
  );
});

for (const kind of [
  "create failure",
  "malformed session",
  "missing delivery URL",
  "byte failure",
]) {
  test(`image ${kind} preserves prior image and profile draft`, async ({
    page,
  }) => {
    const fixture = await enter(page);
    await field(page, "name").fill("Kept image draft");
    if (kind === "create failure") fixture.uploadCreateFailures = 1;
    if (kind === "malformed session") fixture.malformedUpload = true;
    if (kind === "missing delivery URL") fixture.missingDeliveryUrl = true;
    if (kind === "byte failure") fixture.uploadByteFailures = 1;
    await upload(page);
    await expect(app(page).locator(".form-error[role='alert']")).toBeVisible();
    await expect(app(page).locator(".logo-preview img")).toHaveAttribute(
      "src",
      IMAGE_URL,
    );
    await expect(field(page, "name")).toHaveValue("Kept image draft");
    await expect(field(page, "name")).toBeEnabled();
    expect(profileWrites(fixture)).toEqual([]);
    expect(fixture.uploadBytes).toHaveLength(kind === "byte failure" ? 1 : 0);
  });
}

test("actor change during image creation prevents provider-byte dispatch", async ({
  page,
}) => {
  const fixture = await enter(page);
  const gate = deferred();
  fixture.uploadCreateGate = gate.promise;
  await app(page).locator("#organization-image").setInputFiles(file);
  await expect
    .poll(
      () =>
        fixture.writes.filter((row) => row.path === "/api/uploads/create")
          .length,
    )
    .toBe(1);
  await rotateSession(page, fixture);
  gate.resolve();
  await expect(app(page)).toContainText("Administration access required");
  expect(fixture.uploadBytes).toEqual([]);
  expect(profileWrites(fixture)).toEqual([]);
});

test("keyboard section navigation and dialogs preserve accessible focus", async ({
  page,
}) => {
  await enter(page);
  const profileTab = action(page, "tab", '[data-tab="profile"]');
  await profileTab.focus();
  await profileTab.press("ArrowRight");
  await expect(action(page, "tab", '[data-tab="outreach"]')).toBeFocused();
  await expect(field(page, "scriptTitle")).toBeVisible();
  await action(page, "tab", '[data-tab="outreach"]').press("Home");
  await expect(profileTab).toBeFocused();
  await action(page, "preview-profile").click();
  await expect(dialog(page)).toHaveAttribute("aria-labelledby", "dialog-title");
  await expect(dialog(page).locator("#dialog-title")).toHaveText(
    "Profile preview",
  );
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(action(page, "preview-profile")).toBeFocused();
  await action(page, "image-url").click();
  expect(
    await dialog(page).evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(field(page, "hostedImageUrl")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(action(page, "image-url")).toBeFocused();
});

test("organization navigation keeps workspace context and asks before leaving unsaved administration", async ({
  page,
}) => {
  const fixture = await enter(page);
  const links = await page
    .locator(".coalition-ui-sidebar .shared-coalition-tabs [data-route]")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent.trim(),
        href: node.getAttribute("data-route"),
      })),
    );
  const workspaceLinks = links.filter(
    (row) => !/All coalitions|Exit workspace|Open app/u.test(row.text),
  );
  expect(workspaceLinks.length).toBeGreaterThan(8);
  for (const row of workspaceLinks)
    expect(row.href).toMatch(
      new RegExp(
        `^(?:${COALITION_PATH}(?:/|$)|/workspace/coalition/${COALITION_ID}/|/organizations/${COALITION_ID}/|/text-banking\\?coalitionId=${COALITION_ID})`,
      ),
    );
  await field(page, "name").fill("Keep when cancelled");
  await page
    .locator(`.coalition-ui-sidebar [data-route="${COALITION_PATH}/members"]`)
    .click();
  await expect(dialog(page)).toContainText("Leave Administration?");
  await action(page, "close-dialog").first().click();
  await expect(field(page, "name")).toHaveValue("Keep when cancelled");
  await page
    .locator(`.coalition-ui-sidebar [data-route="${COALITION_PATH}/members"]`)
    .click();
  await action(page, "confirm-action").click();
  await expect(page).toHaveURL(new RegExp(`${COALITION_PATH}/members$`));
  await expect(page.locator(".coalition-ui-sidebar")).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test("revisionless compatibility never fabricates a zero precondition", async ({
  page,
}) => {
  const fixture = await enter(page, { revisionMode: "legacy" });
  await field(page, "name").fill("Legacy compatible save");
  await save(page);
  await saved(page);
  const body = profileWrites(fixture)[0].body;
  expect(Object.hasOwn(body, "expectedRevision")).toBe(false);
  expect(profileWrites(fixture)[0].headers["if-match"]).toBeUndefined();
  expect(body.clientRequestId).toBeTruthy();
});

test("outreach loading error has a working retry that preserves existing profile draft", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Profile remains while retrying");
  fixture.scriptReadFailures = 1;
  const gate = deferred();
  fixture.nextScriptReadGate = gate.promise;
  await action(page, "tab", '[data-tab="outreach"]').click();
  await expect(app(page)).toContainText("Loading outreach templates");
  gate.resolve();
  await expect(app(page)).toContainText("Templates unavailable");
  await action(page, "refresh-scripts").click();
  await expect(field(page, "scriptTitle")).toHaveValue(
    "Community conversation",
  );
  await tab(page, "profile");
  await expect(field(page, "name")).toHaveValue(
    "Profile remains while retrying",
  );
  expect(fixture.writes).toEqual([]);
});

test("server and draft text remains literal HTML-safe text in previews", async ({
  page,
}) => {
  const fixture = await mockAdministrationWorkspace(page);
  fixtures.set(page, fixture);
  fixture.profiles[COALITION_ID].description =
    '<img src=x onerror="window.adminXss=1">';
  fixture.templates[COALITION_ID].phoneCall.body =
    "<script>window.adminXss=2</script> {{firstName}}";
  await page.goto(`${BASE_URL}${ADMIN_PATH}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(field(page, "description")).toHaveValue(
    '<img src=x onerror="window.adminXss=1">',
  );
  await action(page, "preview-profile").click();
  await expect(dialog(page)).toContainText(
    '<img src=x onerror="window.adminXss=1">',
  );
  await expect(dialog(page).locator("[onerror],script")).toHaveCount(0);
  await action(page, "close-dialog").first().click();
  await tab(page, "outreach");
  await expect(app(page).locator("[data-script-preview]")).toContainText(
    "<script>window.adminXss=2</script> Casey",
  );
  expect(await page.evaluate(() => window.adminXss)).toBeUndefined();
});

test("same-actor credential refresh keeps both drafts and rechecks authority before saving", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Profile survives refresh");
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Outreach survives refresh");
  await rotateSession(page, fixture, {
    actor: "alex",
    role: "admin",
    version: "rotated",
  });
  await expect(field(page, "scriptTitle")).toHaveValue(
    "Outreach survives refresh",
  );
  await tab(page, "profile");
  await expect(field(page, "name")).toHaveValue("Profile survives refresh");
  await save(page);
  await saved(page);
  await tab(page, "outreach");
  await expect(field(page, "scriptTitle")).toHaveValue(
    "Outreach survives refresh",
  );
  expect(profileWrites(fixture)).toHaveLength(1);
  await tab(page, "profile");
  const staleRead = deferred();
  fixture.nextProfileReadGate = staleRead.promise;
  const readCount = fixture.requests.filter(
    (row) =>
      row.path === `/api/coalitions/${COALITION_ID}` && row.method === "GET",
  ).length;
  await page.clock.setFixedTime(FIXED_TIME + 2000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(
      () =>
        fixture.requests.filter(
          (row) =>
            row.path === `/api/coalitions/${COALITION_ID}` &&
            row.method === "GET",
        ).length,
    )
    .toBeGreaterThan(readCount);
  await field(page, "name").fill("Newer than the pending read");
  await save(page);
  await saved(page);
  staleRead.resolve();
  await expect(field(page, "name")).toHaveValue("Newer than the pending read");
  await expect(app(page).locator("#save-state")).toHaveText("Saved just now");
});

test("backend officer compatibility alias retains administrator capabilities", async ({
  page,
}) => {
  const fixture = await enter(page, { role: "officer" });
  await expect(app(page).locator("#role-label")).toHaveText("Admin");
  await field(page, "name").fill("Officer compatibility");
  await save(page);
  await saved(page);
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Officer shared copy");
  await save(page);
  await saved(page);
  expect(profileWrites(fixture)).toHaveLength(1);
  expect(scriptWrites(fixture)).toHaveLength(1);
});

test("overlapping authority refresh keeps newer restricted access when an older administrator response arrives last", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Keep my local profile draft");
  const older = deferred();
  fixture.nextProfileReadGate = older.promise;
  await page.clock.setFixedTime(FIXED_TIME + 2000);
  const before = fixture.requests.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(
      () =>
        fixture.requests
          .slice(before)
          .filter((row) => row.path === `/api/coalitions/${COALITION_ID}`)
          .length,
    )
    .toBe(1);
  fixture.role = "leader";
  fixture.profiles[COALITION_ID].name = "Latest restricted organization";
  fixture.profiles[COALITION_ID].organizationMutationRevision = 2;
  await page.clock.setFixedTime(FIXED_TIME + 4000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(field(page, "name")).toBeDisabled();
  await expect(page.locator(".coalition-ui-sidebar")).toContainText(
    "Latest restricted organization",
  );
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/coalitions/${COALITION_ID}`) &&
      response.headers().etag === `"org:${COALITION_ID}:1"`,
  );
  older.resolve();
  await (await oldResponse).finished();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(field(page, "name")).toHaveValue("Keep my local profile draft");
  await expect(field(page, "name")).toBeDisabled();
  await expect(action(page, "save")).toBeHidden();
  await expect(page.locator(".coalition-ui-sidebar")).toContainText(
    "Latest restricted organization",
  );
  expect(fixture.writes).toEqual([]);
});

test("transient same-actor renewal outage preserves independent drafts and waits for an intentional retry", async ({
  page,
}) => {
  const fixture = await enter(page);
  await field(page, "name").fill("Profile kept during renewal outage");
  await tab(page, "outreach");
  await field(page, "scriptTitle").fill("Outreach kept during renewal outage");
  await tab(page, "profile");
  fixture.refreshFailures = 1;
  fixture.refreshStatus = 503;
  await page.clock.setFixedTime(FIXED_TIME + 3600000 + 1000);
  await save(page);
  await expect(field(page, "name")).toHaveValue(
    "Profile kept during renewal outage",
  );
  await expect(field(page, "name")).toBeEnabled();
  await expect(app(page).locator("[role='alert']")).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.authRequests).toHaveLength(1);
  await tab(page, "outreach");
  await expect(field(page, "scriptTitle")).toHaveValue(
    "Outreach kept during renewal outage",
  );
  expect(fixture.writes).toEqual([]);
  await save(page);
  await saved(page);
  expect(fixture.authRequests).toHaveLength(2);
  expect(scriptWrites(fixture)).toHaveLength(1);
  await tab(page, "profile");
  await expect(field(page, "name")).toHaveValue(
    "Profile kept during renewal outage",
  );
});

test("browser Back and Forward protect unsaved drafts and a pending save without duplicate writes", async ({
  page,
}) => {
  const fixture = await enter(page);
  await page.evaluate(
    ({ admin, people }) => {
      history.replaceState({}, "", people);
      history.pushState({}, "", admin);
    },
    { admin: ADMIN_PATH, people: `${COALITION_PATH}/members` },
  );
  await field(page, "name").fill("Back keeps this draft");
  await page.goBack();
  await expect(dialog(page)).toContainText("Leave Administration?");
  await expect(page).toHaveURL(new RegExp(`${ADMIN_PATH}$`));
  await action(page, "close-dialog").first().click();
  await expect(field(page, "name")).toHaveValue("Back keeps this draft");
  await page.goBack();
  await expect(dialog(page)).toContainText("Leave Administration?");
  await action(page, "confirm-action").click();
  await expect(page).toHaveURL(new RegExp(`${COALITION_PATH}/members$`));
  expect(fixture.writes).toEqual([]);

  await page.goto(`${BASE_URL}${ADMIN_PATH}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(field(page, "name")).toHaveValue("Cedar Valley Coalition");
  await page.evaluate(
    (people) => history.pushState({}, "", people),
    `${COALITION_PATH}/members`,
  );
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${ADMIN_PATH}$`));
  await field(page, "name").fill("Forward keeps this draft");
  await page.goForward();
  await expect(dialog(page)).toContainText("Leave Administration?");
  await action(page, "close-dialog").first().click();
  await expect(field(page, "name")).toHaveValue("Forward keeps this draft");

  await page.evaluate(
    (people) => history.pushState({}, "", people),
    `${COALITION_PATH}/members`,
  );
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${ADMIN_PATH}$`));
  const pending = deferred();
  fixture.nextProfileWriteGate = pending.promise;
  await action(page, "save").click();
  await expect.poll(() => profileWrites(fixture).length).toBe(1);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${ADMIN_PATH}$`));
  await expect(app(page)).toHaveAttribute("data-admin-operation", "profile");
  expect(profileWrites(fixture)).toHaveLength(1);
  pending.resolve();
  await saved(page);
  await expect(field(page, "name")).toHaveValue("Forward keeps this draft");
  expect(profileWrites(fixture)).toHaveLength(1);
  expect(fixture.profileApplications).toHaveLength(1);
});
