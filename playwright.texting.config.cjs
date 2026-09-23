const base = require("./playwright.config.cjs");

process.env.POLIS_TEST_BASE_URL = "http://127.0.0.1:9074";

module.exports = {
  ...base,
  testMatch: ["files/texting-*.pw.spec.cjs"],
  workers: 1,
  use: { ...base.use, baseURL: process.env.POLIS_TEST_BASE_URL },
  webServer: {
    command:
      "npm start --prefix frontend -- --no-open --host 127.0.0.1 --port 9074",
    url: "http://127.0.0.1:9074/organizations/example/texting",
    reuseExistingServer: false,
    timeout: 120000,
  },
};
