const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

module.exports = defineConfig({
  testDir: path.join(__dirname, "files"),
  testMatch: ["coalition-workspace.pw.spec.cjs"],
  outputDir:
    process.env.POLIS_WORKSPACE_NAV_OUTPUT_DIR ||
    path.join(__dirname, "../test-results/workspace-navigation"),
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9060",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        }
      : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
});
