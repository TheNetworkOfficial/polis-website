const { defineConfig } = require("@playwright/test");
const path = require("node:path");
const artifacts =
  "D:/CodexHome/artifacts/polis-ballot-texting-handoff-20261015/website";
process.env.POLIS_TEST_BASE_URL = "http://127.0.0.1:9208";
process.env.POLIS_BALLOT_TEST_ARTIFACTS = path.join(
  artifacts,
  "output/playwright",
);
module.exports = defineConfig({
  testDir: "files",
  testMatch: /ballot-(?:register-texting|register|chaser)\.pw\.spec\.cjs/,
  timeout: 35000,
  expect: { timeout: 10000 },
  workers: 1,
  outputDir: path.join(artifacts, "output/playwright"),
  use: {
    baseURL: process.env.POLIS_TEST_BASE_URL,
    viewport: { width: 1280, height: 950 },
    launchOptions: {
      executablePath:
        "D:/CodexHome/cache/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/territory-development-static-server.cjs",
    cwd: path.resolve(__dirname, ".."),
    env: {
      POLIS_WEB_TEST_DIST: path.join(artifacts, "production-dist"),
      POLIS_WEB_TEST_PORT: "9208",
    },
    url: "http://127.0.0.1:9208/settings/candidate-access",
    reuseExistingServer: false,
  },
});
