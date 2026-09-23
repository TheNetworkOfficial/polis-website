export function hasFilesEntitlement(workspace) {
  return (
    workspace?.entitlement === "organization_files" &&
    workspace?.featureFlags?.filesEnabled === true
  );
}

export function hasFilesView(workspace) {
  const permissions = new Set(workspace?.permissions || []);
  return Boolean(
    workspace?.capabilities?.canView === true || permissions.has("files_view"),
  );
}

export function isFilesWorkspaceAccessible(workspace) {
  return hasFilesEntitlement(workspace) && hasFilesView(workspace);
}
