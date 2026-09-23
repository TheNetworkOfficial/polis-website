const base = require("./playwright.config.cjs");

process.env.POLIS_TEST_BASE_URL = "http://127.0.0.1:9082";

module.exports = {
  ...base,
  workers: 1,
  grep: /coalition navigation|member access stays|coalition rooms|Files home is entitled|explicit Files workspace links|folder filtering and sorting|proposal review, restricted|upload progress preserves|redesigned workspace/,
  testMatch: [
    "files/coalition-workspace.pw.spec.cjs",
    "files/files.pw.spec.cjs",
    "files/texting-workspace.pw.spec.cjs",
  ],
  use: { ...base.use, baseURL: process.env.POLIS_TEST_BASE_URL },
  webServer: {
    command:
      "npm start --prefix frontend -- --no-open --host 127.0.0.1 --port 9082",
    url: "http://127.0.0.1:9082/coalitions",
    reuseExistingServer: false,
    timeout: 120000,
  },
};
