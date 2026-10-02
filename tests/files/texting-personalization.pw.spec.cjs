const { test, expect } = require("@playwright/test");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");
const personalization = {
  version: 1,
  fields: ["first_name", "last_name", "full_name", "city", "state"],
};

async function composer(page, enabled = true) {
  const fixture = await mockBook(page, {
    personalization: enabled ? personalization : null,
  });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review selection",
    exact: true,
  });
  await review
    .getByLabel("I reviewed these campaign recipients", { exact: true })
    .check();
  await review
    .getByRole("button", { name: "Continue to write message", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  return fixture;
}

test("Personalize inserts at the caret, previews fictional details, and saves canonical tags for new and edited campaigns", async ({
  page,
}, info) => {
  const fixture = await composer(page);
  const input = page.getByLabel("Message", { exact: true });
  const picker = page.getByRole("combobox", { name: "Personalize message" });
  const preview = page.locator(".pt-workspace-preview");
  await expect(picker.locator("option")).toHaveText([
    "Personalize…",
    "First name",
    "Last name",
    "Full name",
    "City",
    "State",
  ]);
  async function expectCompactPicker() {
    const heading = await page
      .locator('label[for="campaign-message"]')
      .boundingBox();
    const control = await picker.boundingBox();
    expect(control.x).toBeGreaterThan(heading.x + heading.width);
    expect(
      Math.abs(heading.y + heading.height / 2 - control.y - control.height / 2),
    ).toBeLessThan(3);
  }
  await expectCompactPicker();
  await input.fill("Hi ! Example Civic Team: Reply STOP to opt out.");
  await input.press("Control+Home");
  for (let i = 0; i < 3; i++) await input.press("ArrowRight");
  await picker.selectOption("first_name");
  await expect(input).toHaveValue(
    "Hi {{first_name}}! Example Civic Team: Reply STOP to opt out.",
  );
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => element.selectionStart)).toBe(17);
  await input.pressSequentially(", welcome");
  await expect(input).toHaveValue(
    "Hi {{first_name}}, welcome! Example Civic Team: Reply STOP to opt out.",
  );
  await expect(preview).toContainText("Hi Alex, welcome!");
  await expect(preview).toContainText("EXAMPLE PREVIEW");
  await expect(preview).toContainText("Example · SMS · 1 segment(s)");
  await expect(
    page.getByRole("region", { name: "Campaign estimate" }),
  ).toContainText("Varies by recipient");
  await preview.getByText("If a detail is missing", { exact: true }).click();
  await expect(preview).toContainText("First name: “there”");
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Personalized invitation");
  await page.getByLabel("Spending limit ($)", { exact: true }).fill("10");
  await page.screenshot({
    path: info.outputPath("personalize-desktop-light.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: info.outputPath("personalize-desktop-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await expectCompactPicker();
  await page.screenshot({
    path: info.outputPath("personalize-mobile-dark.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: info.outputPath("personalize-mobile-light.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 2,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Personalized invitation", exact: true }),
  ).toBeVisible();
  const save = fixture.calls.find(
    (call) => call.path === `${PROMPT}/campaigns` && call.method === "POST",
  );
  expect(save.body.templateText).toContain("{{first_name}}");
  expect(save.body.templateText).not.toContain("Alex");
  expect(Object.keys(save.body)).not.toContain("personalization");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(input).toHaveValue(/\{\{first_name\}\}/);
  await input.fill("Example Civic Team in . Reply STOP to opt out.");
  await input.press("Control+Home");
  for (let i = 0; i < 22; i++) await input.press("ArrowRight");
  await picker.focus();
  // Force a pending form render while the picker owns keyboard focus.
  await page.evaluate(() => {
    const form = document.querySelector('[data-workspace-form="campaign"]');
    form.querySelector('textarea[name="templateText"]').dataset.beforeRender =
      "true";
    form
      .querySelector('[name="budget"]')
      .dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(input).not.toHaveAttribute("data-before-render", "true");
  await expect(picker).toBeFocused();
  await picker.press("End");
  await expect(input).toHaveValue(
    "Example Civic Team in {{state}}. Reply STOP to opt out.",
  );
  await expect(input).toBeFocused();
  expect(
    fixture.calls.some((call) => /transition|\/confirm|\/send/.test(call.path)),
  ).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("invalid fields stay inline, HTML stays text, and full messages cannot overflow through insertion", async ({
  page,
}) => {
  const fixture = await composer(page);
  const input = page.getByLabel("Message", { exact: true });
  const save = page.getByRole("button", { name: "Save campaign", exact: true });
  for (const tag of [
    "{{unknown}}",
    "{{ first_name }}",
    "{{First_Name}}",
    "{{first_name",
    "{first_name}",
    "[[first_name]]",
    "{{{first_name}}}",
  ]) {
    await input.fill(`Example Civic Team: Hi ${tag}. Reply STOP to opt out.`);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#campaign-message-error")).toBeVisible();
    await expect(save).toBeDisabled();
  }
  await input.fill(
    '<img src=x onerror="window.badPreview=true"> {{full_name}}. Reply STOP to opt out.',
  );
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".pt-workspace-preview img")).toHaveCount(0);
  await expect(page.locator(".pt-workspace-preview")).toContainText(
    "<img src=x",
  );
  expect(await page.evaluate(() => window.badPreview)).toBeUndefined();
  await input.fill("x".repeat(1573) + "Reply STOP to opt out.");
  const before = await input.inputValue();
  await input.press("Control+End");
  await page
    .getByRole("combobox", { name: "Personalize message" })
    .selectOption("first_name");
  await expect(input).toHaveValue(before);
  await expect(page.locator("#campaign-message-error")).toContainText(
    "Make room",
  );
  await expect(save).toBeDisabled();
  await input.fill("Example Civic Team: Hello. Reply STOP to opt out.");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#campaign-message-error")).toHaveCount(0);
  expect(
    fixture.calls.filter(
      (call) => call.method === "POST" && call.path.startsWith(PROMPT),
    ),
  ).toEqual([]);
});

test("a workspace without personalization keeps ordinary editing and rejects pasted tags", async ({
  page,
}) => {
  await composer(page, false);
  await expect(
    page.getByRole("combobox", { name: "Personalize message" }),
  ).toHaveCount(0);
  const input = page.getByLabel("Message", { exact: true });
  await input.fill(
    "Example Civic Team: Hi {{first_name}}. Reply STOP to opt out.",
  );
  await expect(page.locator("#campaign-message-error")).toContainText(
    "unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Save campaign", exact: true }),
  ).toBeDisabled();
  await input.fill("Example Civic Team: Hi friend. Reply STOP to opt out.");
  await expect(page.locator("#campaign-message-error")).toHaveCount(0);
  await expect(page.locator(".pt-workspace-preview")).toContainText(
    "MESSAGE PREVIEW",
  );
});

for (const stream of ["standard", "opt_in"])
  test(`invalid personalized ${stream} content stays unsendable and can be skipped`, async ({
    page,
  }) => {
    const fixture = await mockBook(page, { personalization });
    const writes = [];
    await page.route(`${BASE}${PROMPT}/**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.slice(PROMPT.length);
      const respond = (body) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, ...body }),
        });
      if (request.method() !== "GET")
        writes.push({ path, body: request.postDataJSON() });
      if (path === "/workspace")
        return respond({
          workspace: {
            provider: "prompt",
            scopeKey: "coalition:org-1",
            manualOnly: true,
            status: "configured",
            canSend: true,
            personalization,
            capabilities: { manualQueue: true, readContactBook: true },
          },
        });
      if (path === "/campaigns/campaign-one")
        return respond({
          campaign: {
            campaignId: "campaign-one",
            name: "Personalized invitation",
            status: "active",
            templateText:
              "Example Civic Team: Hi {{first_name}}. Reply STOP to opt out.",
            canFetchQueue: true,
            blockedReasons: [],
          },
        });
      if (path === "/campaigns/campaign-one/queue")
        return respond({
          state: "held",
          items: [
            {
              itemId: "invalid-personalization",
              stream,
              state: "blocked",
              expiresAtMs: Date.now() + 60_000,
              blockedReasons: ["texting_personalization_value_invalid"],
              humanConfirmation: null,
              preview: {
                contactDisplayName: "Example Recipient",
                contactPhone: "+12025550124",
                message: "",
              },
            },
          ],
        });
      if (path === "/campaigns/campaign-one/queue/invalid-personalization/skip")
        return respond({
          result: {
            itemId: "invalid-personalization",
            state: stream === "opt_in" ? "skipped" : "accepted",
          },
        });
      return route.fallback();
    });
    await page.goto(`${BASE}/organizations/org-1/texting/send/campaign-one`);
    await page
      .getByRole("button", { name: "Get my next messages", exact: true })
      .click();
    await expect(
      page.getByText("Message needs attention", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Send to Example Recipient",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Check recipient again", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Skip recipient", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "You’re caught up", exact: true }),
    ).toBeVisible();
    expect(writes.map(({ path }) => path)).toEqual([
      "/campaigns/campaign-one/queue",
      "/campaigns/campaign-one/queue/invalid-personalization/skip",
    ]);
    expect(fixture.errors).toEqual([]);
  });
