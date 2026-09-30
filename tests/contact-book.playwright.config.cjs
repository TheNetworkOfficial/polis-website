process.env.POLIS_TEST_BASE_URL ||= "http://127.0.0.1:9187";
const base = require("../playwright.config.cjs");
module.exports = {
  ...base,
  testDir: ".",
  outputDir: "../output/playwright/contact-book-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:9187" },
  webServer: {
    command:
      "npm start --prefix frontend -- --no-open --host 127.0.0.1 --port 9187",
    cwd: require("node:path").resolve(__dirname, ".."),
    url: "http://127.0.0.1:9187/files",
    reuseExistingServer: false,
    timeout: 120000,
  },
};
