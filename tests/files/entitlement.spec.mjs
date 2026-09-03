import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL(
  "../../frontend/src/pages/files/scripts/filesEntitlements.js",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { hasFilesEntitlement, hasFilesView, isFilesWorkspaceAccessible } =
  await import(moduleUrl);

function eligibleWorkspace() {
  return {
    entitlement: "organization_files",
    featureFlags: { filesEnabled: true },
    permissions: ["files_view"],
  };
}

test("Files entitlement requires an explicitly enabled feature flag", () => {
  const workspace = eligibleWorkspace();
  assert.equal(hasFilesEntitlement(workspace), true);

  delete workspace.featureFlags.filesEnabled;
  assert.equal(hasFilesEntitlement(workspace), false);
  assert.equal(isFilesWorkspaceAccessible(workspace), false);
});

test("Files access requires the entitlement and an explicit view grant", () => {
  const workspace = eligibleWorkspace();
  assert.equal(hasFilesView(workspace), true);
  assert.equal(isFilesWorkspaceAccessible(workspace), true);

  workspace.permissions = [];
  assert.equal(isFilesWorkspaceAccessible(workspace), false);
  workspace.capabilities = { canView: true };
  assert.equal(isFilesWorkspaceAccessible(workspace), true);
});
