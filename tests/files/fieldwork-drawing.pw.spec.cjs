const { test, expect } = require("@playwright/test");
const {
  BASE_URL,
  COALITION_PATH,
  mockFieldworkWorkspace,
} = require("./fixtures/fieldwork-workspace.cjs");

test("draw, undo, draft save and existing-boundary edit preserve the published plan through conflict recovery", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await mockFieldworkWorkspace(page);
  await page.goto(`${BASE_URL}${COALITION_PATH}/voter-map`);
  const workspace = page.locator(".polis-field-work");
  await expect(workspace).toHaveAttribute("aria-busy", "false");
  await expect(workspace.locator(".map-record").first()).toBeVisible();
  await workspace
    .getByRole("button", { name: "New territory", exact: true })
    .click();
  const dialog = page.locator(".polis-field-work dialog[open]");
  await dialog
    .getByRole("textbox", { name: "Plan name", exact: true })
    .fill("Drawn Cedar");
  await dialog
    .getByRole("radio", { name: "Draw an area", exact: true })
    .check();
  await expect(
    dialog.getByRole("textbox", { name: "Plan name", exact: true }),
  ).toHaveValue("Drawn Cedar");
  async function drawRectangle() {
    const canvas = dialog.locator(".field-builder-map canvas").first();
    await expect(canvas).toBeVisible();
    const size = await canvas.boundingBox();
    expect(size.width).toBeGreaterThan(200);
    expect(size.height).toBeGreaterThan(200);
    for (const [x, y] of [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ])
      await canvas.click({
        position: { x: size.width * x, y: size.height * y },
      });
  }
  await drawRectangle();
  await dialog.getByRole("button", { name: "Undo point", exact: true }).click();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(() => fixture.builderDraft?.areaGeojson?.coordinates[0].length)
    .toBe(4);
  await dialog
    .getByRole("button", { name: "Clear drawing", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.locator("#fw-builder-validation")).toBeVisible();
  expect(fixture.errors).toEqual([]);
  await drawRectangle();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(() => fixture.builderDraft?.areaGeojson?.coordinates[0].length)
    .toBe(5);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog
    .getByRole("spinbutton", { name: "Number of territories", exact: true })
    .fill("2");
  await dialog
    .getByRole("button", { name: "Generate territories", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Review plan", exact: true })
    .click();
  await expect(dialog.locator("[data-fwb-assignee]")).toHaveCount(2);
  for (const select of await dialog.locator("[data-fwb-assignee]").all())
    await select.selectOption("alex");
  await expect(
    dialog.getByRole("button", { name: "Publish territories", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Publish territories", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const published = fixture.territories.filter((t) => t.builderId);
  expect(published).toHaveLength(2);
  const target = published[0];
  const original = structuredClone(
    fixture.builderDraft.territories.find((t) => t.id === target.builderId)
      .geojson,
  );
  await workspace.getByRole("tab", { name: /^Territories/ }).click();
  await workspace
    .locator(".territory-card")
    .filter({ hasText: target.name })
    .getByRole("button", { name: "View territory", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Edit boundary", exact: true })
    .click();
  const handle = dialog.locator(".field-boundary-handle").first();
  await expect(handle).toBeVisible();
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(handle).toBeFocused();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(() =>
      JSON.stringify(
        fixture.builderDraft.territories.find((t) => t.id === target.builderId)
          .geojson,
      ),
    )
    .not.toBe(JSON.stringify(original));
  await dialog
    .getByRole("button", { name: "Undo boundary change", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Undo boundary change", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(
      () =>
        fixture.builderDraft.territories.find((t) => t.id === target.builderId)
          .geojson,
    )
    .toEqual(original);
  await dialog
    .getByRole("button", { name: "Review plan", exact: true })
    .click();
  fixture.builderConflict = true;
  await dialog
    .getByRole("button", { name: "Publish territories", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Reload saved plan", exact: true }),
  ).toBeVisible();
  fixture.builderConflict = false;
  await dialog
    .getByRole("button", { name: "Reload saved plan", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Review plan", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Publish territories", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.territories.filter((t) => t.builderId)).toHaveLength(2);
  expect(
    fixture.territories.find((t) => t.builderId === target.builderId)
      .territoryId,
  ).toBe(target.territoryId);
  expect(fixture.assignments[target.territoryId]).toEqual(["alex"]);
  expect(fixture.errors).toEqual([]);
});
