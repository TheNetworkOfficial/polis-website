import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { prepareRouting, cohortPattern } = createRequire(import.meta.url)(
  "../scripts/prepare-geocode-cohort-routing.cjs",
);
const workerAssets = [
  { path: "/570.js", bytes: 100, sha256: "a".repeat(64) },
  { path: "/570.js.LICENSE.txt", bytes: 10, sha256: "b".repeat(64) },
];
const version = "polis-geocode-gates-20261027-abcdef0";
const block = `    location ~ ^/(feed|coalitions)(/.*)?$ {
        sub_filter_once on;
        sub_filter 'src="/scripts/shared-feed.js"' 'src="/scripts/shared-feed.js?v=unrelated-version"';
        proxy_pass http://127.0.0.1:3000;
    }
`;
const scoped = `    # Geocoding beta: direct People/contacts and Field Work entry for the two approved organizations.
    location ~ ^/old-cohort-only$ {
        sub_filter_once on;
        sub_filter 'src="/scripts/shared-feed.js"' 'src="/scripts/shared-feed.js?v=polis-geocode-beta-20261027-a2ae957"';
        proxy_pass http://127.0.0.1:3000;
    }
`;
const baseline = `map $arg_v $polis_combined_css_root_20261024 {\n    default /old;\n}\nmap $arg_v $polis_setup_js_root_20261018 {\n    default /old;\n}\nserver {\n    location = /css/shared-feed.css {\n        root /old;\n    }\n${scoped}${block}}\n`;
test("routing upgrades dashboard and ordinary organization entries while preserving incumbent assets and exact rollback", () => {
  const result = prepareRouting({
    baseline,
    workerAssets,
    version,
    release: `/var/www/polis-website-releases/${version}`,
  });
  assert.equal(result.rollback, baseline);
  assert.equal(result.proof.exactBaselineReconstruction, true);
  assert.equal(result.proof.bridgeProxyLocations, 2);
  assert.ok(result.candidate.includes("v=unrelated-version"));
  assert.ok(result.candidate.includes("default /old;"));
  assert.ok(result.candidate.includes("location = /terms {"));
  assert.ok(result.candidate.includes("location = /privacy-policy {"));
  assert.ok(result.candidate.includes("location = /footer {"));
  const route = new RegExp(cohortPattern);
  for (const scope of ["ns7aq23r", "wnkwaes5"])
    for (const prefix of ["workspace/coalition", "coalitions", "organizations"])
      for (const suffix of [
        "",
        "/",
        "/home",
        "/people/contacts",
        "/voter-map",
        "/calendar",
        "/texting",
      ])
        assert.equal(route.test(`/${prefix}/${scope}${suffix}`), true);
  for (const path of [
    "/feed",
    "/coalitions",
    "/coalitions/other/home",
    "/coalitions/ns7aq23r-extra",
    "/workspace/candidate/ns7aq23r/home",
  ])
    assert.equal(route.test(path), false);
});
test("routing preparation rejects unrecognized baselines and invalid release targets", () => {
  assert.throws(
    () =>
      prepareRouting({
        baseline: "server {}",
        workerAssets,
        version,
        release: `/var/www/polis-website-releases/${version}`,
      }),
    /ambiguous/,
  );
  assert.throws(
    () =>
      prepareRouting({
        baseline,
        workerAssets,
        version,
        release: "/var/www/other",
      }),
    /invalid/,
  );
  assert.throws(
    () =>
      prepareRouting({
        baseline,
        workerAssets,
        version,
        release: `/var/www/polis-website-releases/${version}`,
        publicAssets: ["/scripts/unrelated.js"],
      }),
    /invalid/,
  );
});

test("county processor routes and stage inventory are mandatory and cannot retain an old numeric alias", () => {
  const input = {
    baseline,
    version,
    release: `/var/www/polis-website-releases/${version}`,
    workerAssets,
  };
  const result = prepareRouting(input);
  assert.ok(result.candidate.includes("location = /570.js {"));
  assert.ok(result.candidate.includes("location = /570.js.LICENSE.txt {"));
  assert.deepEqual(result.proof.requiredStageAssets, workerAssets);
  assert.equal(result.proof.stagedWorkerVerificationRequired, true);
  assert.throws(
    () => prepareRouting({ ...input, workerAssets: undefined }),
    /worker_inventory_required/,
  );
  assert.throws(
    () => prepareRouting({ ...input, workerAssets: [workerAssets[0]] }),
    /worker_inventory_required/,
  );
  assert.throws(
    () =>
      prepareRouting({
        ...input,
        baseline: baseline + "location = /570.js {\n}",
      }),
    /worker_route_collision_requires_review/,
  );
});

test("scoped worker routes leave an incumbent numeric worker alias intact", () => {
  const incumbent = "location = /570.js {\n    alias /old/processor.js;\n}\n";
  const scopedWorkers = workerAssets.map((asset) => ({
    ...asset,
    publicPath: `/polis-household-assets-20261028${asset.path}`,
  }));
  const input = {
    baseline: baseline + incumbent,
    version,
    release: `/var/www/polis-website-releases/${version}`,
    workerAssets: scopedWorkers,
  };
  const result = prepareRouting(input);
  assert.ok(result.candidate.endsWith(incumbent));
  assert.ok(
    result.candidate.includes(
      "location = /polis-household-assets-20261028/570.js {",
    ),
  );
  assert.ok(
    result.candidate.includes(`alias ${input.release}/frontend/dist/570.js;`),
  );
  assert.ok(
    result.candidate.includes(
      "location = /polis-household-assets-20261028/570.js.LICENSE.txt {",
    ),
  );
  assert.deepEqual(result.proof.requiredStageAssets, scopedWorkers);
  assert.throws(
    () =>
      prepareRouting({
        ...input,
        workerAssets: [
          { ...scopedWorkers[0], publicPath: "/polis-household/../570.js" },
          scopedWorkers[1],
        ],
      }),
    /worker_inventory_required/,
  );
});
