const { test, expect } = require("@playwright/test");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
let server, base;
const scripts = path.join(
  __dirname,
  "../frontend/src/pages/shared-feed/scripts",
);
test.beforeAll(async () => {
  const manifest = JSON.parse(
    await readFile(path.join(scripts, "policy-set.json"), "utf8"),
  );
  const tokens = (
    await readFile(
      path.join(__dirname, "../frontend/src/css/polis-design-system.css"),
      "utf8",
    )
  ).replace(/^@import[^\r\n]*\r?\n/m, "");
  const css = await readFile(
    path.join(
      __dirname,
      "../frontend/src/pages/shared-feed/css/policy-acceptance.css",
    ),
    "utf8",
  );
  server = createServer(async (request, response) => {
    const name = request.url.slice(1);
    if (["policyAcceptance.js", "policySnapshot.js"].includes(name)) {
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(path.join(scripts, name)));
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${tokens}\n${css}</style></head><body><p>Local policy test</p><script type="module">
      import {createPolicyAcceptanceController} from '/policyAcceptance.js';
      const manifest=${JSON.stringify(manifest)};window.actor='first';window.writes=[];
      const controller=createPolicyAcceptanceController({getUserId:()=>window.actor,request:async(path,options)=>{
        if(path==='/api/policies/current'){if(window.failLoad)throw Error('offline');return manifest;}
        if(options?.method==='POST'){options.beforeDispatch?.();window.writes.push(options.body);return {ok:true,accepted:true,policySetVersion:manifest.policySetVersion};}
        return {ok:true,accepted:false};
      }});window.review=()=>controller.review({force:true});window.review();
    </script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
test("full in-page reader leaves agreement unchecked and only explicit acceptance persists", async ({
  page,
}) => {
  await page.goto(base);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByRole("checkbox")).toBeEnabled();
  await dialog.locator("summary").filter({ hasText: "Privacy Policy" }).click();
  await expect(
    dialog.getByText("Google API Limited Use", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.writes.length)).toBe(0);
  await page.screenshot({
    path: "output/playwright/policy-review-desktop.png",
  });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Agree & continue" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.writes.length)).toBe(1);
});
test("mobile reader supports browsing without acceptance", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page
    .locator("html")
    .evaluate((element) =>
      element.setAttribute("data-polis-theme-resolved", "light"),
    );
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByRole("checkbox")).toBeEnabled();
  const bounds = await dialog.boundingBox();
  await expect(dialog).toHaveCSS("font-family", /Roboto/);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "output/playwright/policy-review-mobile.png" });
  await dialog.getByRole("button", { name: "Continue browsing" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.writes.length)).toBe(0);
});
