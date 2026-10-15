const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");
const port = Number(process.env.POLIS_MT_TEST_PORT || 9196);
module.exports = defineConfig({
  testDir: ".",
  testMatch: "montana-candidate.pw.spec.cjs",
  outputDir: "../output/playwright/montana-signup/results",
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/montana-candidate-static-server.cjs",
    cwd: path.resolve(__dirname, ".."),
    url: `http://127.0.0.1:${port}/settings/candidate-access`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
