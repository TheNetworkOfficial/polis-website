const text = (value) => String(value ?? "").trim();
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

function scopeValue(scopeType, scopeId) {
  if (!["coalition", "candidate"].includes(scopeType)) return null;
  const id = text(scopeId);
  return id &&
    ![...id].some(
      (character) =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        character === "/" ||
        character === "\\",
    )
    ? { scopeType, scopeId: id }
    : null;
}

/** A URL carries presentation context only; callers still authorize its actor. */
export function workspaceNavigationScope(pathname, search = "") {
  try {
    const path = text(pathname);
    const workspace =
      /^\/workspace\/(coalition|candidate)\/([^/]+)(?:\/|$)/u.exec(path);
    if (workspace)
      return scopeValue(workspace[1], decodeURIComponent(workspace[2]));
    const campaign = /^\/candidate-dashboard\/([^/]+)(?:\/|$)/u.exec(path);
    if (campaign)
      return scopeValue("candidate", decodeURIComponent(campaign[1]));
    const coalition = /^\/coalitions\/([^/]+)(?:\/|$)/u.exec(path);
    if (coalition && !["start", "join"].includes(coalition[1]))
      return scopeValue("coalition", decodeURIComponent(coalition[1]));
    const organization =
      /^\/organizations\/([^/]+)\/(?:texting(?:\/|$)|texting-balance(?:\/|$)|governance(?:\/|$))/u.exec(
        path,
      );
    if (organization)
      return scopeValue("coalition", decodeURIComponent(organization[1]));
    const room =
      /^\/messages\/servers\/(coalition|candidate)\/([^/]+)(?:\/|$)/u.exec(
        path,
      );
    if (room) return scopeValue(room[1], decodeURIComponent(room[2]));
    const query = new URLSearchParams(search);
    return scopeValue(
      query.get("organizationScopeType"),
      query.get("organizationScopeId"),
    );
  } catch {
    return null;
  }
}

/** Preserve organization navigation on shared detail pages and across reloads. */
export function withWorkspaceNavigationScope(path, scope, origin) {
  if (!scopeValue(scope?.scopeType, scope?.scopeId)) return path;
  try {
    const url = new URL(path, origin);
    if (url.origin !== new URL(origin).origin) return path;
    if (/^\/(?:auth(?:\/|$)|coalitions\/?$)/u.test(url.pathname))
      return `${url.pathname}${url.search}${url.hash}`;
    const explicit = workspaceNavigationScope(url.pathname);
    if (!explicit) {
      url.searchParams.set("organizationScopeType", scope.scopeType);
      url.searchParams.set("organizationScopeId", scope.scopeId);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}

export function workspaceDashboardPath(scope) {
  return scope?.scopeType === "candidate"
    ? `/candidate-dashboard/${encodeURIComponent(scope.scopeId)}`
    : `/coalitions/${encodeURIComponent(scope?.scopeId || "")}`;
}

export function workspaceFilesPath(filesWorkspaceId, scope) {
  const query = new URLSearchParams({ workspace: filesWorkspaceId });
  if (scopeValue(scope?.scopeType, scope?.scopeId)) {
    query.set("organizationScopeType", scope.scopeType);
    query.set("organizationScopeId", scope.scopeId);
  }
  return `/files?${query}`;
}

const paths = {
  dashboard: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.87a4 4 0 0 1 0 7.75",
  messages:
    "M21 11a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l2.4-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 13 3h.5a8.5 8.5 0 0 1 8 8z",
  mission: "M9 3h6v4H9zm-3 2H4v16h16V5h-2M7 12l2 2 4-4m-6 8h10",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zm6-3v15m6-12v15",
  calendar: "M4 5h16v16H4zm3-3v6m10-6v6M4 11h16",
  election: "M5 3h14v18H5zm4 5h6m-6 4h6m-6 4h3",
  share:
    "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2.6-1.5 6.8 4m0-11-6.8 4",
  settings:
    "m9 3-1 4-4 2v6l4 2 1 4h6l1-4 4-2V9l-4-2-1-4zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
};
export const workspaceNavigationIcon = (name) =>
  `<svg class="shared-feed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.dashboard}"/></svg>`;

/** The same outer navigation can surround independent, authorized tool bundles. */
export function renderWorkspaceNavigationFrame({
  scope,
  name,
  navItems = [],
  activeKey = "",
  content = "",
  logoUrl = "",
  icon = workspaceNavigationIcon,
  extraClass = "",
  topbarHtml = "",
  navHtml = "",
  identityHtml = "",
  sidebarFooterHtml = "",
}) {
  const dashboard = workspaceDashboardPath(scope);
  const chooser =
    scope?.scopeType === "candidate" ? "/candidate-dashboard" : "/coalitions";
  const chooserLabel =
    scope?.scopeType === "candidate" ? "All campaigns" : "All coalitions";
  const links =
    navHtml ||
    `<nav class="shared-coalition-tabs" aria-label="Organization sections">${navItems.map((item) => `<a class="shared-coalition-tab${item.key === activeKey ? " is-active" : ""}${item.enabled === false ? " is-muted" : ""}"${item.enabled === false ? ' aria-disabled="true" tabindex="-1"' : ` href="${escape(item.href)}" data-action="navigate" data-route="${escape(item.href)}"`}${item.key === activeKey ? ' aria-current="page"' : ""}><span>${icon(item.icon || "dashboard")}</span><strong>${escape(item.label)}</strong></a>`).join("")}</nav>`;
  const exit =
    '<button class="coalition-ui-all coalition-ui-exit" type="button" data-action="workspace-exit" data-route="/feed">Exit workspace</button>';
  const topbar =
    topbarHtml ||
    `<header class="coalition-ui-topbar"><a class="coalition-ui-brand" href="${escape(dashboard)}" data-action="navigate" data-route="${escape(dashboard)}">${logoUrl ? `<img src="${escape(logoUrl)}" alt="" width="40" height="40" />` : ""}<span>Polis</span></a><a class="coalition-ui-switcher" href="${chooser}" data-action="navigate" data-route="${chooser}" aria-label="Choose organization">${escape(name || "Organization")} <span aria-hidden="true">⌄</span></a><div class="coalition-ui-topbar__actions"></div></header>`;
  const identity =
    identityHtml ||
    `<span class="shared-coalition-avatar">${escape(text(name).slice(0, 1).toUpperCase() || "O")}</span>`;
  return `<section class="shared-page shared-coalition-workspace ${escape(extraClass)}" data-organization-workspace="${escape(scope?.scopeType)}:${escape(scope?.scopeId)}">${topbar}<div class="coalition-ui-layout"><aside class="coalition-ui-sidebar"><div class="coalition-ui-sidebar__identity">${identity}<strong>${escape(name || "Organization")}</strong></div>${links}<button class="coalition-ui-all" type="button" data-action="navigate" data-route="${chooser}">${chooserLabel}</button>${sidebarFooterHtml}${exit}</aside><div class="shared-page__content coalition-ui-content"><details class="coalition-ui-mobile-nav"><summary>Coalition menu</summary>${links}${sidebarFooterHtml}${exit}</details>${content}</div></div></section>`;
}
