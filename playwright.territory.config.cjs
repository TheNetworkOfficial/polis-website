const base = require("./playwright.config.cjs");
process.env.POLIS_TEST_BASE_URL ||= "http://127.0.0.1:9086";
const path = require("node:path");
const artifacts =
  process.env.TERRITORY_BUILDER_ARTIFACTS ||
  path.join(__dirname, "test-results/territory-builder");
module.exports = {
  ...base,
  workers: 1,
  testMatch: ["territory-builder.pw.spec.cjs"],
  outputDir: path.join(artifacts, "playwright-results"),
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:9086",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command:
      "npm start --prefix frontend -- --no-open --host 127.0.0.1 --port 9086",
    url: "http://127.0.0.1:9086/coalitions",
    reuseExistingServer: true,
    timeout: 120000,
  },
};
