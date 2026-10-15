const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");
const artifacts =
  process.env.POLIS_TERRITORY_TEST_ARTIFACTS ||
  "D:/CodexHome/artifacts/polis-geocodio-development-20261015/website";
module.exports = defineConfig({
  testDir: ".",
  testMatch: "territory-development.pw.spec.cjs",
  outputDir: path.join(artifacts, "playwright/results"),
  timeout: 35000,
  expect: { timeout: 12000 },
  workers: 1,
  fullyParallel: false,
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: {
      executablePath:
        "D:/CodexHome/cache/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "production", use: { baseURL: "http://127.0.0.1:9204" } },
    { name: "development", use: { baseURL: "http://127.0.0.1:9205" } },
  ],
  webServer: [
    {
      command: "node tests/territory-development-static-server.cjs",
      cwd: path.resolve(__dirname, ".."),
      env: {
        POLIS_WEB_TEST_DIST: path.join(artifacts, "production-dist"),
        POLIS_WEB_TEST_PORT: "9204",
      },
      url: "http://127.0.0.1:9204/settings/candidate-access",
      reuseExistingServer: false,
    },
    {
      command: "node tests/territory-development-static-server.cjs",
      cwd: path.resolve(__dirname, ".."),
      env: {
        POLIS_WEB_TEST_DIST: path.join(artifacts, "development-dist"),
        POLIS_WEB_TEST_PORT: "9205",
      },
      url: "http://127.0.0.1:9205/settings/candidate-access",
      reuseExistingServer: false,
    },
  ],
});
