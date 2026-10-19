import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const digest = (raw) => createHash("sha256").update(raw).digest("hex");
function entries(manifest) {
  const result = new Map();
  for (const row of manifest.files || []) {
    if (
      typeof row.path !== "string" ||
      row.path.startsWith("/") ||
      row.path.includes("\\") ||
      row.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      !/^[a-f0-9]{64}$/.test(row.sha256 || "") ||
      result.has(row.path)
    )
      throw new Error("invalid_frontend_manifest");
    result.set(row.path, row.sha256);
  }
  if (!result.size) throw new Error("empty_frontend_manifest");
  return result;
}

/** Refuse a release that loses a live source overlay or changes an unreviewed build input. */
export async function verifyFrontendPreservation({ root, baseline, reviewed }) {
  root = resolve(root);
  const old = entries(baseline),
    approved = entries(reviewed);
  const actual = new Map();
  for (const name of new Set([...old.keys(), ...approved.keys()])) {
    const target = resolve(root, name);
    if (relative(root, target).startsWith(".." + sep))
      throw new Error("frontend_path_outside_root");
    let hash;
    try {
      hash = digest(await readFile(target));
    } catch {
      throw new Error("missing_frontend_input:" + name);
    }
    const expected = approved.get(name) || old.get(name);
    if (hash !== expected)
      throw new Error("unreviewed_frontend_change:" + name);
    actual.set(name, hash);
  }
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const target = resolve(directory, item.name);
      if (item.isDirectory()) await walk(target);
      else {
        const name = relative(root, target).split(sep).join("/");
        if (!actual.has(name))
          throw new Error("unreviewed_frontend_addition:" + name);
      }
    }
  }
  await walk(resolve(root, "frontend/src"));
  return {
    passed: true,
    baselineFiles: old.size,
    reviewedFiles: approved.size,
    verifiedFiles: actual.size,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [root, baselinePath, reviewedPath] = process.argv.slice(2);
  try {
    if (!root || !baselinePath || !reviewedPath)
      throw new Error("usage: root baseline_manifest reviewed_manifest");
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const reviewed = JSON.parse(await readFile(reviewedPath, "utf8"));
    console.log(
      JSON.stringify(
        await verifyFrontendPreservation({ root, baseline, reviewed }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
