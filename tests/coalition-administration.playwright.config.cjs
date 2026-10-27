const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

module.exports = defineConfig({
  testDir: path.join(__dirname, "administration"),
  testMatch: ["coalition-administration.pw.spec.cjs"],
  outputDir:
    process.env.POLIS_ADMINISTRATION_OUTPUT_DIR ||
    path.join(__dirname, "../test-results/administration"),
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9068",
    timezoneId: "America/Denver",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    trace: "on",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
});
