const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const baseURL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9054";
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
module.exports = defineConfig({
  testDir: path.join(__dirname, "files"),
  testMatch: [
    "fieldwork-workspace.pw.spec.cjs",
    "fieldwork-drawing.pw.spec.cjs",
  ],
  outputDir:
    process.env.POLIS_FIELDWORK_OUTPUT_DIR ||
    path.join(root, "test-results/fieldwork"),
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    launchOptions: browserExecutable
      ? { executablePath: browserExecutable }
      : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `npm start --prefix frontend -- --no-open --host 127.0.0.1 --port ${new URL(baseURL).port || "9054"}`,
    cwd: root,
    url: `${baseURL}/coalitions`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
