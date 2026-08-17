const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/files",
  testMatch: "**/*.pw.spec.cjs",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:9000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm start --prefix frontend -- --no-open --host 127.0.0.1",
    url: "http://127.0.0.1:9000/files",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
