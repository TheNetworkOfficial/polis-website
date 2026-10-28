process.env.POLIS_TEST_BASE_URL ||= "http://127.0.0.1:9187";
const path = require("node:path");
const base = require("./fieldwork.playwright.config.cjs");
module.exports = {
  ...base,
  testMatch: [
    "fieldwork-workspace.pw.spec.cjs",
    "contact-book-households.pw.spec.cjs",
  ],
  outputDir: path.resolve(__dirname, "../output/playwright/household-release"),
  webServer: { ...base.webServer, reuseExistingServer: false },
};
