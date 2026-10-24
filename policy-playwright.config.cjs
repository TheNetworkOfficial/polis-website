const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "policy-acceptance.pw.spec.cjs",
  workers: 1,
  timeout: 30000,
  use: { headless: true },
  outputDir: "output/playwright/results",
  reporter: "list",
});
