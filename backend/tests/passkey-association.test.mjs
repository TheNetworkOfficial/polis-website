import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/routes/postShares.js", import.meta.url),
  "utf8",
);

test("Android association grants both deep-link and passkey credentials to the configured signed app", () => {
  const start = source.indexOf(
    'router.get("/.well-known/assetlinks.json"',
  );
  const end = source.indexOf(
    'router.get("/.well-known/apple-app-site-association"',
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = source.slice(start, end);
  assert.match(
    route,
    /delegate_permission\/common\.handle_all_urls/,
  );
  assert.match(
    route,
    /delegate_permission\/common\.get_login_creds/,
  );
  assert.match(route, /ANDROID_APP_PACKAGE/);
  assert.match(route, /ANDROID_SHA256_CERT_FINGERPRINTS/);
  assert.match(route, /sha256_cert_fingerprints: fingerprints/);
});

test("Apple association uses the same explicit app IDs for links and webcredentials", () => {
  const start = source.indexOf(
    'router.get("/.well-known/apple-app-site-association"',
  );
  assert.notEqual(start, -1);
  const route = source.slice(start);
  assert.match(route, /IOS_APP_IDS \|\| process\.env\.IOS_APP_ID/);
  assert.match(route, /applinks:\s*\{[\s\S]*details,/);
  assert.match(
    route,
    /webcredentials:\s*\{\s*apps: appIds,\s*\}/,
  );
});
