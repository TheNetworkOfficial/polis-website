/* Offline, additive routing preparation. This never connects to a host. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const cohortPattern =
  "^/(?:workspace/coalition|coalitions|organizations)/(?:ns7aq23r|wnkwaes5)(?:/.*)?/?$";

function prepareRouting({ baseline, version, release }) {
  if (
    !/^polis-geocode-gates-20261027-[a-f0-9]{7,40}$/.test(version) ||
    release !== `/var/www/polis-website-releases/${version}`
  )
    throw Error("geocode_routing_release_invalid");
  let candidate = baseline;
  const deltas = [];
  function replace(before, after) {
    if (candidate.split(before).length !== 2)
      throw Error("geocode_routing_baseline_ambiguous");
    candidate = candidate.replace(before, after);
    deltas.push({ before, after });
  }
  for (const map of [
    "polis_combined_css_root_20261024",
    "polis_setup_js_root_20261018",
  ]) {
    const anchor = `map $arg_v $${map} {`;
    replace(anchor, `${anchor}\n    ${version} ${release}/frontend/dist;`);
  }
  const scoped = candidate.match(
    / {4}# Geocoding beta: direct People\/contacts and Field Work entry for the two approved organizations\.[\s\S]*?^ {4}}\r?\n/m,
  )?.[0];
  if (!scoped) throw Error("geocode_routing_scoped_baseline_missing");
  const updated = scoped
    .replace(
      /^ {4}# Geocoding beta:.*$/m,
      "    # Geocoding beta: ordinary navigation and all entry routes for the two approved organizations.",
    )
    .replace(/^ {4}location ~ .* \{$/m, `    location ~ ${cohortPattern} {`)
    .replace(/polis-geocode-beta-20261027-[a-f0-9]{7,40}/g, version);
  replace(scoped, updated);
  const blocks = [
    ...candidate.matchAll(/^ {4}location ~ [^\n]+\r?\n[\s\S]*?^ {4}}\r?\n/gm),
  ]
    .map((match) => match[0])
    .filter((block) =>
      block.includes("sub_filter 'src=\"/scripts/shared-feed.js"),
    );
  if (!blocks.length) throw Error("geocode_routing_html_proxy_missing");
  for (const block of blocks) {
    if (block.includes("geocode-cohort-entry.js"))
      throw Error("geocode_routing_bridge_already_present");
    replace(
      block,
      block.replace(
        /( {8}sub_filter_once on;)/,
        `$1\n        sub_filter '</head>' '<script defer src="/scripts/geocode-cohort-entry.js?v=${version}"></script></head>';`,
      ),
    );
  }
  const bridge = `    # Scoped navigation bridge; old asset/version mappings remain intact.\n    location = /scripts/geocode-cohort-entry.js {\n        root $polis_setup_js_root_20261018;\n        default_type application/javascript;\n        try_files $uri =404;\n    }\n\n`;
  const assetAnchor = "    location = /css/shared-feed.css {";
  replace(assetAnchor, bridge + assetAnchor);
  let restored = candidate;
  for (const delta of [...deltas].reverse())
    restored = restored.replace(delta.after, delta.before);
  if (restored !== baseline) throw Error("geocode_routing_unrelated_delta");
  return {
    candidate,
    rollback: baseline,
    proof: {
      baselineSha256: hash(baseline),
      candidateSha256: hash(candidate),
      exactBaselineReconstruction: true,
      bridgeProxyLocations: blocks.length,
      cohortPattern,
      existingAssetMappingsPreserved: true,
      serviceRestartRequired: false,
    },
  };
}
module.exports = { prepareRouting, cohortPattern };
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (rows, item, index, all) =>
          index % 2
            ? rows
            : [...rows, [item.replace(/^--/, ""), all[index + 1]]],
        [],
      ),
  );
  if (
    !args.baseline ||
    !args.version ||
    !args.output ||
    Object.keys(args).some(
      (key) => !["baseline", "version", "output"].includes(key),
    )
  )
    throw Error(
      "usage: --baseline D:/review/current.conf --version polis-geocode-gates-20261027-COMMIT --output D:/review/new",
    );
  if (
    process.platform === "win32" &&
    !/^[dD]:[\\/]/.test(path.resolve(args.output))
  )
    throw Error("D_drive_output_required");
  const baseline = fs.readFileSync(args.baseline, "utf8");
  const result = prepareRouting({
    baseline,
    version: args.version,
    release: `/var/www/polis-website-releases/${args.version}`,
  });
  fs.mkdirSync(args.output, { recursive: true });
  for (const [file, contents] of Object.entries({
    "nginx-candidate.conf": result.candidate,
    "nginx-rollback.conf": result.rollback,
    "routing-proof.json":
      JSON.stringify(
        {
          ...result.proof,
          version: args.version,
          preparedOnly: true,
          cloudWrites: false,
        },
        null,
        2,
      ) + "\n",
  }))
    fs.writeFileSync(path.join(args.output, file), contents, { flag: "wx" });
  process.stdout.write(JSON.stringify(result.proof) + "\n");
}
