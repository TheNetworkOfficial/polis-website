import {
  workspaceFilesPath,
  withWorkspaceNavigationScope,
} from "../../shared-feed/scripts/workspaceNavigation.js";

const text = (value) => String(value ?? "").trim();

/** A Files entitlement never substitutes for active organization membership. */
export function filesOrganizationNavigation({
  scope,
  descriptor,
  payload,
  actorId,
}) {
  const principal = descriptor?.principal || {};
  const type = text(principal.sourceType || principal.type);
  const id = text(principal.id);
  const coalition = payload?.coalition;
  const membership = payload?.membership;
  if (
    scope?.scopeType !== "coalition" ||
    !["organization", "coalition"].includes(type) ||
    id !== scope.scopeId ||
    text(coalition?.coalitionId || coalition?.id) !== scope.scopeId ||
    !membership ||
    !actorId
  )
    return null;
  const status = text(membership.status || membership.state).toLowerCase();
  if (
    membership.isActive === false ||
    membership.isPending === true ||
    !(status
      ? ["active", "approved"].includes(status)
      : membership.isActive === true)
  )
    return null;
  const role = text(
    membership.roleKey || membership.role_key || membership.role,
  ).toLowerCase();
  const isAdmin = role === "admin";
  const permissions = new Set(
    Array.isArray(membership.permissions) ? membership.permissions : [],
  );
  const has = (...keys) => isAdmin || keys.some((key) => permissions.has(key));
  const base = `/coalitions/${encodeURIComponent(scope.scopeId)}`;
  const navItems = [
    ["overview", "Home", base, "dashboard", true],
    ["members", "People", `${base}/members`, "team", true],
    ["rooms", "Rooms", `${base}/rooms`, "messages", true],
    [
      "missions",
      "Missions",
      `${base}/missions`,
      "mission",
      has(
        "missions_view",
        "missions_assign",
        "missions_delegate",
        "missions_approve",
        "mission_templates_manage",
        "missions_manage",
      ),
    ],
    [
      "petitions",
      "Petitions",
      `${base}/petitions`,
      "file",
      has("petitions_manage"),
    ],
    [
      "voter-map",
      "Field work",
      `${base}/voter-map`,
      "map",
      (coalition.voterMapEnabled ?? coalition.voter_map_enabled ?? true) ===
        true && has("voter_map_access", "cta_manage"),
    ],
    [
      "calendar",
      "Calendar",
      `${base}/calendar`,
      "calendar",
      has("calendar_view", "calendar_manage", "calendar_promotion_manage"),
    ],
    [
      "governance",
      "Governance",
      `${base}/governance`,
      "election",
      text(coalition.coalitionType || coalition.type) === "constitutional" ||
        coalition.hasConstitution === true ||
        has(
          "constitution_manage",
          "proposal_manage",
          "vote_manage",
          "speaker_console",
        ),
    ],
    ["amplify", "Amplify", `${base}/amplify`, "share", true],
    [
      "files",
      "Files",
      workspaceFilesPath(descriptor.filesWorkspaceId, scope),
      "file",
      true,
    ],
    [
      "texting",
      "Texting",
      `/organizations/${encodeURIComponent(scope.scopeId)}/texting`,
      "messages",
      true,
    ],
  ].map(([key, label, href, icon, enabled]) => ({
    key,
    label,
    href,
    icon,
    enabled,
  }));
  if (has("contact_book_view"))
    navItems.push({
      key: "ballot-chaser",
      label: "Ballot Chaser",
      href: `/workspace/coalition/${encodeURIComponent(scope.scopeId)}/work/ballot-chaser`,
      icon: "election",
    });
  navItems.push({
    key: "voter-guides",
    label: "Guide workspace",
    href: `/workspace/coalition/${encodeURIComponent(scope.scopeId)}/work/voter-guides`,
    icon: "file",
  });
  if (has("roles_manage", "members_manage", "join_requests_manage"))
    navItems.push({
      key: "administration",
      label: "Administration",
      href: `${base}/admin/edit`,
      icon: "settings",
    });
  return {
    scope,
    actorId,
    name: text(coalition.name || coalition.title) || "Organization",
    isAdmin,
    navItems,
  };
}

/** Keep the selected Files owner and navigation identity through subroutes. */
export function filesNavigationPath(path, { filesWorkspaceId, scope, origin }) {
  if (!scope) return path;
  try {
    const url = new URL(path, origin);
    if (
      url.origin !== new URL(origin).origin ||
      !/^\/files(?:\/|$)/u.test(url.pathname)
    )
      return path;
    if (filesWorkspaceId) url.searchParams.set("workspace", filesWorkspaceId);
    return withWorkspaceNavigationScope(
      `${url.pathname}${url.search}${url.hash}`,
      scope,
      origin,
    );
  } catch {
    return path;
  }
}
