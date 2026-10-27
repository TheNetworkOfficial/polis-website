import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL(
    "../frontend/src/assets/runtime/geocode-cohort-entry.js",
    import.meta.url,
  ),
  "utf8",
);
function fixture({ current = false, throwHistory = false } = {}) {
  const redirects = [],
    events = {},
    writes = [];
  const window = {
    __POLIS_GEOCODE_COHORT_BUNDLE__: current,
    location: {
      href: "https://polis.example/feed",
      origin: "https://polis.example",
      replace: (value) => redirects.push(value),
    },
    history: Object.fromEntries(
      ["pushState", "replaceState"].map((method) => [
        method,
        function (...args) {
          assert.equal(this, window.history);
          if (throwHistory) throw Error("navigation rejected");
          writes.push({ method, args });
          window.location.href = new URL(
            args[2] || window.location.href,
            window.location.href,
          ).href;
          return "original return value";
        },
      ]),
    ),
    addEventListener: (name, callback) => {
      events[name] = callback;
    },
  };
  vm.runInNewContext(source, { window, URL });
  return { window, redirects, events, writes };
}
test("an older SPA entering either pilot scope reloads once, preserving query and router state", () => {
  for (const scope of ["ns7aq23r", "wnkwaes5"])
    for (const prefix of [
      "workspace/coalition",
      "coalitions",
      "organizations",
    ]) {
      const f = fixture();
      const path = `/${prefix}/${scope}/people/contacts?geocoding=1#credits`;
      assert.equal(
        f.window.history.pushState({ draft: true }, "", path),
        "original return value",
      );
      assert.equal(f.writes[0].args[0].draft, true);
      assert.deepEqual(f.redirects, [`https://polis.example${path}`]);
      f.events.popstate();
      assert.equal(f.redirects.length, 1);
    }
});
test("the current bundle, excluded scopes, external hosts and similarly named IDs retain normal SPA behavior", () => {
  for (const path of [
    "/feed",
    "/coalitions/other/home",
    "/coalitions/ns7aq23r-extra/home",
    "https://other.example/coalitions/ns7aq23r/home",
    "/workspace/candidate/ns7aq23r/home",
  ]) {
    const f = fixture();
    f.window.history.pushState({}, "", path);
    assert.deepEqual(f.redirects, []);
  }
  const f = fixture({ current: true });
  f.window.history.replaceState({}, "", "/workspace/coalition/ns7aq23r/home");
  assert.deepEqual(f.redirects, []);
});
test("failed history mutation never bypasses the existing router or triggers a reload", () => {
  const f = fixture({ throwHistory: true });
  assert.throws(
    () => f.window.history.pushState({}, "", "/coalitions/ns7aq23r/home"),
    /rejected/,
  );
  assert.deepEqual(f.redirects, []);
});
test("back navigation into a pilot workspace upgrades an older tab without intercepting clicks or forms", () => {
  const f = fixture();
  f.window.location.href =
    "https://polis.example/coalitions/wnkwaes5/dashboard";
  f.events.popstate();
  assert.deepEqual(f.redirects, [f.window.location.href]);
  assert.deepEqual(Object.keys(f.events), ["popstate"]);
});
