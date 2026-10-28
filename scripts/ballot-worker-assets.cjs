/* Fail closed before a scoped release can omit its browser county processor. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const hash = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

function inspectBallotWorkerAssets(dist) {
  const bundle = fs.readFileSync(
    path.join(dist, "scripts/shared-feed.js"),
    "utf8",
  );
  const references = [
    ...bundle.matchAll(
      /new Worker\(new URL\((?:([$\w]+)\.p|"(\/polis-[a-z0-9]+(?:-[a-z0-9]+)*\/)")\+([$\w]+)\.u\((\d+)\),\3\.b\)\)/g,
    ),
  ];
  // This release uses Webpack's numeric chunk fallback. A changed linker must
  // receive its own reviewed resolver instead of silently skipping the worker.
  if (
    references.length !== 1 ||
    (references[0][1] && references[0][1] !== references[0][3]) ||
    [...bundle.matchAll(/new Worker\(/g)].length !== 1 ||
    !/u:([$\w]+)=>\1\+"\.js"/.test(bundle)
  )
    throw Error("ballot_worker_linker_requires_review");
  const worker = `/${references[0][4]}.js`;
  const publicPrefix = references[0][2];
  const files = [worker, `${worker}.LICENSE.txt`].map((asset) => {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dist, asset.slice(1)));
    } catch {
      throw Error(`ballot_worker_asset_missing:${asset}`);
    }
    if (!raw.length || /^\s*</.test(raw.toString("utf8")))
      throw Error(`ballot_worker_asset_invalid:${asset}`);
    if (asset === worker)
      new vm.Script(raw.toString("utf8"), { filename: asset });
    return {
      path: asset,
      ...(publicPrefix ? { publicPath: publicPrefix + asset.slice(1) } : {}),
      bytes: raw.length,
      sha256: hash(raw),
    };
  });
  return { sharedFeedSha256: hash(bundle), files };
}

function verifyStagedBallotWorkerAssets(inventory, stagedDist) {
  for (const asset of inventory.files) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(stagedDist, asset.path.slice(1)));
    } catch {
      throw Error(`ballot_worker_stage_missing:${asset.path}`);
    }
    if (raw.length !== asset.bytes || hash(raw) !== asset.sha256)
      throw Error(`ballot_worker_stage_changed:${asset.path}`);
  }
  return true;
}

module.exports = { inspectBallotWorkerAssets, verifyStagedBallotWorkerAssets };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--dist" || args[2] !== "--staged")
    throw Error("usage: --dist REVIEWED_DIST --staged STAGED_DIST");
  const inventory = inspectBallotWorkerAssets(path.resolve(args[1]));
  verifyStagedBallotWorkerAssets(inventory, path.resolve(args[3]));
  process.stdout.write(JSON.stringify({ ok: true, ...inventory }) + "\n");
}
