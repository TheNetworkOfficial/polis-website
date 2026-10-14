/** Stable personal-layout IDs shared with the native app and server. */
export const dashboardCards = {
  activity: ["Organization activity", "activity", "Participation and progress"],
  attention: ["Needs attention", "alert", "Work needing review"],
  field: [
    "On the streets",
    "footprints",
    "Doors, conversations and turf progress",
  ],
  texting: ["Text banking", "messages", "Delivery and replies"],
  coverage: ["Team coverage", "users", "Recorded field coverage"],
  schedule: ["Coming up", "calendar", "Your next events or tasks"],
  followups: ["Field follow-ups", "signpost", "Requests needing a next step"],
  teams: ["Field teams", "users", "Field participation"],
  replies: ["Reply queue", "inbox", "Conversations waiting for a reply"],
  textTeam: ["Texting team", "users", "Your campaign team"],
  assignment: ["Your next task", "flag", "One clear next step"],
  progress: ["Your progress", "check-circle", "Your completed assignments"],
  updates: ["Team update", "megaphone", "Updates from your organization"],
  files: ["Files", "folder", "Recent shared folders"],
};
export const cardIds = Object.keys(dashboardCards);
export const hasPermission = (workspace, ...permissions) =>
  workspace?.isOwner === true ||
  workspace?.isAdmin === true ||
  permissions.some((permission) =>
    workspace?.permissions?.includes(permission),
  );
const hasPrefix = (workspace, prefix) =>
  hasPermission(workspace) ||
  workspace?.permissions?.some((value) => value.startsWith(prefix));
export function dashboardRole(workspace) {
  const role = String(workspace?.role || "")
    .replaceAll("_", "-")
    .toLowerCase();
  if (
    workspace?.isOwner ||
    workspace?.isAdmin ||
    ["admin", "campaign-admin"].includes(role)
  )
    return "admin";
  if (
    role === "text-banking-coordinator" ||
    hasPermission(workspace, "text_bank_supervise", "text_bank_room_manage")
  )
    return "text";
  if (
    [
      "field-director",
      "deputy-field-director",
      "canvassing-coordinator",
      "territory-manager",
      "precinct-captain",
      "door-knocking-organizer",
      "field-organizer",
      "lead-organizer",
    ].includes(role)
  )
    return "field";
  return "volunteer";
}
export function defaultDashboardLayout(workspace) {
  const visible = {
    admin: ["activity", "attention", "field", "texting", "schedule"],
    field: ["field", "followups", "teams", "schedule"],
    text: ["texting", "replies", "textTeam", "schedule"],
    volunteer: ["assignment", "schedule", "progress", "updates"],
  }[dashboardRole(workspace)];
  return {
    schemaVersion: 1,
    order: [...visible, ...cardIds.filter((id) => !visible.includes(id))],
    hidden: cardIds.filter((id) => !visible.includes(id)),
  };
}
export function availableDashboardCards(workspace) {
  const allowed = new Set(["updates"]);
  if (hasPermission(workspace, "audit_view")) allowed.add("activity");
  if (
    hasPermission(
      workspace,
      "missions_assign",
      "missions_delegate",
      "missions_approve",
      "missions_manage",
      "mission_templates_manage",
      "posts_approve_manage",
      "files_review",
    )
  )
    allowed.add("attention");
  if (
    hasPermission(
      workspace,
      "voter_map_access",
      "voter_map_manager",
      "voter_map_territory",
      "voter_registry",
    )
  )
    ["field", "coverage", "followups", "teams"].forEach((id) =>
      allowed.add(id),
    );
  if (hasPrefix(workspace, "missions_"))
    ["assignment", "progress", "schedule"].forEach((id) => allowed.add(id));
  if (hasPrefix(workspace, "calendar_")) allowed.add("schedule");
  if (hasPrefix(workspace, "text_bank_") || hasPrefix(workspace, "prompt_"))
    ["texting", "replies", "textTeam"].forEach((id) => allowed.add(id));
  const filesEnabled =
    workspace?.features?.organizationFiles === true &&
    workspace?.featureFlags?.filesEnabled === true &&
    workspace?.filesWorkspaceId &&
    (workspace.filesEntitlement === "organization_files" ||
      workspace.entitlements?.includes("organization_files"));
  if (filesEnabled && hasPermission(workspace, "files_view"))
    allowed.add("files");
  return allowed;
}
export function checkedDashboardSnapshot(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !("preference" in value)
  )
    throw new Error("Layout unavailable");
  const preference = value.preference;
  if (preference === null && value.revision === 0)
    return { revision: 0, preference: null };
  const valid = (list) =>
    Array.isArray(list) &&
    list.length <= cardIds.length &&
    new Set(list).size === list.length &&
    list.every((id) => cardIds.includes(id));
  if (
    !preference ||
    preference.schemaVersion !== 1 ||
    preference.revision !== value.revision ||
    value.revision < 1 ||
    !valid(preference.order) ||
    !valid(preference.hidden) ||
    preference.hidden.some((id) => !preference.order.includes(id))
  )
    throw new Error("Layout unavailable");
  return {
    revision: value.revision,
    preference: {
      schemaVersion: 1,
      order: [...preference.order],
      hidden: [...preference.hidden],
    },
  };
}
export const visibleDashboardCards = (layout, allowed) =>
  layout.order.filter((id) => !layout.hidden.includes(id) && allowed.has(id));

/** A partial read never becomes a complete total or an invented zero. */
export function checkedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function personalJobProgress(jobs) {
  const completed = jobs.filter((job) =>
    ["completed", "approved"].includes(job.status),
  ).length;
  return {
    completed,
    total: jobs.length,
    percent: jobs.length ? (completed * 100) / jobs.length : null,
  };
}
export function recentActivityBars(events) {
  const buckets = new Map();
  for (const event of events) {
    const time = Date.parse(event.occurredAt || event.createdAt || "");
    if (!Number.isFinite(time)) continue;
    const hour = Math.floor(time / 3600000) * 3600000;
    buckets.set(hour, (buckets.get(hour) || 0) + 1);
  }
  return [...buckets]
    .sort(([a], [b]) => a - b)
    .slice(-6)
    .map(([time, value]) => ({ time, value }));
}
