import { escapeText as e } from "./textingWorkspaceUi";
import {
  dashboardCards,
  cardIds,
  dashboardRole,
  defaultDashboardLayout,
  availableDashboardCards,
  checkedDashboardSnapshot,
  visibleDashboardCards,
} from "./organizationDashboardModel";
import { createDashboardData } from "./organizationDashboardData";
import "../css/organization-dashboard.css";

const paths = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/>',
  footprints:
    '<path d="M7 4c3 0 3 9 0 9S4 4 7 4Zm10 4c3 0 3 9 0 9s-3-9 0-9ZM5 17l3 3m7 0 3 1"/>',
  messages: '<path d="M15 12H5l-3 3V3h13Zm4-5h3v14l-4-3H9v-3"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-12 4h2m3 0h2m-8 3h2"/>',
  signpost: '<path d="M12 3v19M4 6h13l4 4-4 4H4l3-4z"/>',
  inbox: '<path d="M4 4h16l2 10v7H2v-7Zm-2 10h6l2 3h4l2-3h6"/>',
  flag: '<path d="M4 22V3m0 1c6-4 10 4 16 0v11c-6 4-10-4-16 0"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 6-7"/>',
  megaphone: '<path d="m3 9 17-6v18L3 15Zm2 7 2 6h4l-2-5M20 8h2v8h-2"/>',
  folder:
    '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  customize: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2 7M3 3v8h8"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.flag}</svg>`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const count = (value) =>
  Number.isFinite(value) ? value.toLocaleString() : "—";
const when = (value, options) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, options)
    : "";
};
const button = (
  action,
  label,
  { value = "", classes = "pd-button", disabled = false, aria = "" } = {},
) =>
  `<button type="button" class="${classes}" data-dashboard-action="${action}" data-value="${e(value)}"${disabled ? " disabled" : ""}${aria ? ` aria-label="${e(aria)}"` : ""}>${label}</button>`;
const metric = (item) =>
  `<div class="pd-metric"><strong>${e(count(item.value))}${item.partial ? "+" : ""}</strong><span>${e(item.label)}</span>${item.note ? `<small>${e(item.note)}</small>` : ""}</div>`;

/** The approved card layout, backed by existing authorized reads and private preferences. */
export function createOrganizationDashboard({
  request,
  context,
  changed,
  navigate,
  clock = () => new Date(),
}) {
  let view = {},
    generation = 0,
    host,
    focusSelector,
    drag,
    lastResumeAt = 0;
  const identity = () => {
    const scope = context();
    return scope?.userId && scope?.scopeType && scope?.scopeId
      ? `${scope.userId}:${scope.scopeType}:${scope.scopeId}`
      : "";
  };
  const current = (key = view.key, version = generation) =>
    Boolean(
      key && identity() === key && view.key === key && generation === version,
    );
  const reset = () => {
    generation++;
    view = {};
    host = null;
    drag = null;
  };
  const guard = (key, version) => {
    if (!current(key, version)) throw new Error("Dashboard changed");
  };
  function allowed() {
    return availableDashboardCards(view.workspace);
  }
  function visible() {
    return view.layout
      ? visibleDashboardCards(
          view.editing ? view.draft : view.layout,
          allowed(),
        )
      : [];
  }
  async function call(
    path,
    options = {},
    key = view.key,
    version = generation,
  ) {
    guard(key, version);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const result = await request(path, {
        auth: true,
        ...options,
        signal: controller.signal,
        beforeRequest: () => guard(key, version),
      });
      guard(key, version);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  function revoke() {
    generation++;
    view.data = null;
    view.saving = false;
    view.reading = false;
    view.refreshing = false;
    view.loading = false;
    view.library = false;
    view.detail = false;
    view.cards = {};
    view.layout = null;
    view.draft = null;
    view.editing = false;
    view.workspace = null;
    view.loaded = false;
    view.error = "Your access changed. Reopen the dashboard.";
    changed();
  }
  function applySnapshot(snapshot) {
    const checked = checkedDashboardSnapshot(snapshot);
    view.revision = checked.revision;
    view.layout = checked.preference || defaultDashboardLayout(view.workspace);
    view.loaded = true;
  }
  function neededCards() {
    const page = context()?.page;
    return page === "priorities"
      ? ["attention"].filter((id) => allowed().has(id))
      : page === "field-overview"
        ? ["field", "coverage", "teams", "followups"].filter((id) =>
            allowed().has(id),
          )
        : visible();
  }
  async function load({ force = false, soft = false } = {}) {
    const key = identity();
    if (!key) {
      reset();
      return;
    }
    if (view.key === key && view.reading) return;
    if (view.key === key && soft && (view.editing || view.saving)) return;
    if (view.key === key && view.loaded && !force) {
      view.reading = true;
      try {
        await loadCards();
      } finally {
        view.reading = false;
        changed();
      }
      return;
    }
    const retaining = view.key === key && view.loaded;
    if (retaining) {
      generation++;
      view.refreshing = true;
      view.error = "";
      view.message = "";
    } else {
      reset();
      view = { key, loading: true, cards: {}, error: "", loaded: false };
    }
    view.reading = true;
    const version = generation,
      scope = { ...context() };
    changed();
    try {
      const bootstrap = await call(
        "/api/me/organization-workspaces",
        {},
        key,
        version,
      );
      const workspace = bootstrap.workspaces?.find(
        (item) =>
          item.scopeType === scope.scopeType && item.scopeId === scope.scopeId,
      );
      if (!workspace)
        throw Object.assign(new Error("Access changed"), { status: 403 });
      view.workspace = workspace;
      scope.routes = {
        ...scope.routes,
        files: workspace.filesWorkspaceId
          ? `/files?workspace=${encodeURIComponent(workspace.filesWorkspaceId)}`
          : "/files",
      };
      const snapshot =
        workspace.dashboardPreferences?.status === "ready"
          ? workspace.dashboardPreferences
          : await call(
              `/api/organizations/${encodeURIComponent(scope.scopeType)}/${encodeURIComponent(scope.scopeId)}/dashboard-preferences`,
              { headers: { "X-Polis-Expected-Actor": scope.userId } },
              key,
              version,
            );
      applySnapshot(snapshot);
      view.loading = false;
      view.data = createDashboardData({
        call: (path, options) => call(path, options, key, version),
        workspace,
        scope,
        routes: scope.routes,
        now: clock,
      });
      changed();
      await loadCards({ refresh: retaining });
      await loadCards();
    } catch (error) {
      if (!current(key, version)) return;
      if ([401, 403].includes(error?.status)) revoke();
      else if (retaining)
        view.message = "Couldn’t refresh. Showing your last update.";
      else view.error = "Your layout could not load. Try again.";
    } finally {
      if (current(key, version)) {
        view.loading = false;
        view.refreshing = false;
        view.reading = false;
        changed();
      }
    }
  }
  async function resume() {
    if (!identity() || document.hidden || Date.now() - lastResumeAt < 1500)
      return;
    lastResumeAt = Date.now();
    await load({ force: true, soft: true });
  }
  async function loadCard(id, { refresh = false } = {}) {
    const key = view.key,
      version = generation,
      previous = view.cards[id];
    if (
      !current(key, version) ||
      !allowed().has(id) ||
      previous?.loading ||
      (!refresh && previous?.value)
    )
      return;
    view.cards[id] = {
      ...previous,
      loading: !previous?.value,
      refreshing: Boolean(previous?.value),
    };
    changed();
    try {
      const value = await view.data.load(id);
      guard(key, version);
      view.cards[id] = { value };
    } catch (error) {
      if (!current(key, version)) return;
      if ([401, 403].includes(error?.status)) revoke();
      else {
        view.cards[id] = previous?.value
          ? { ...previous, refreshing: false, error: "Refresh unavailable" }
          : { error: "Not available right now" };
        if (previous?.value)
          view.message =
            "Some updates couldn’t load. Your last update is still here.";
      }
    }
    if (current(key, version)) changed();
  }
  async function loadCards(options = {}) {
    await Promise.all(neededCards().map((id) => loadCard(id, options)));
  }
  function row(item, defaultIcon) {
    const content = `<span class="pd-icon-tile">${icon(item.icon || defaultIcon)}</span><span class="pd-row-copy"><span class="pd-row-title">${e(item.title)}</span>${item.note ? `<span class="pd-row-note">${e(item.note)}</span>` : ""}</span>${item.value !== undefined ? `<span class="pd-row-value">${e(count(item.value))}</span>` : ""}${item.route ? icon("right") : ""}`;
    return item.route
      ? button("navigate", content, { value: item.route, classes: "pd-row" })
      : `<div class="pd-row">${content}</div>`;
  }
  function rows(items, defaultIcon) {
    return `<div class="pd-stack">${items.map((item) => row(item, defaultIcon)).join("")}</div>`;
  }
  function progress(percent, label, right) {
    return `<div><div class="pd-progress-label"><span>${e(label)}</span><span>${e(right)}</span></div><div class="pd-progress" role="img" aria-label="${e(`${label}: ${right}`)}"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div></div>`;
  }
  function cardBody(id, value) {
    const items = value.metrics || [],
      entries = value.rows || [];
    if (id === "activity") {
      const max = Math.max(1, ...(value.bars || []).map((bar) => bar.value));
      return `<div class="pd-metric-grid">${items.map(metric).join("")}</div><div><div class="pd-chart-heading"><span>Recent activity</span><span>Updates / hour</span></div>${value.bars?.length ? `<div class="pd-activity-visual" role="img" aria-label="Recent organization activity by hour">${value.bars.map((bar) => `<div class="pd-hour"><span>${bar.value}</span><span class="pd-hour-bar" style="height:${Math.max(4, (bar.value / max) * 52)}px"></span><span>${e(new Date(bar.time).toLocaleTimeString(undefined, { hour: "numeric", hour12: true }))}</span></div>`).join("")}</div>` : `<div class="pd-card-state"><p>${e(value.empty)}</p></div>`}</div>`;
    }
    if (id === "schedule")
      return entries.length
        ? `<div class="pd-stack">${entries.map((item) => button("navigate", `<span class="pd-calendar-tile"><small>${e(when(item.timestamp, { month: "short" }).toUpperCase())}</small><strong>${e(when(item.timestamp, { day: "numeric" }))}</strong></span><span class="pd-row-copy"><span class="pd-row-title">${e(item.title)}</span>${item.note ? `<span class="pd-row-note">${e(item.note)}</span>` : ""}</span><span class="pd-time">${e(new Date(item.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</span>`, { value: item.route || value.route, classes: "pd-row" })).join("")}</div>`
        : empty(value.empty);
    if (id === "assignment")
      return entries.length
        ? `<h3>${e(entries[0].title)}</h3><div class="pd-task-meta"><span>${icon("flag")}${e(entries[0].note || "Assigned to you")}</span>${entries[0].timestamp ? `<span>${icon("calendar")}${e(new Date(entries[0].timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span>` : ""}</div><div class="pd-task-bottom">${button("navigate", `${e(value.action)} ${icon("arrow")}`, { value: value.route, classes: "pd-button pd-primary" })}</div>`
        : `${empty(value.empty)}<div class="pd-task-bottom">${button("navigate", `${e(value.action)} ${icon("arrow")}`, { value: value.route, classes: "pd-button pd-primary" })}</div>`;
    if (id === "progress") {
      const p = value.progress;
      return p?.total
        ? `<div class="pd-lead-number"><strong>${count(p.completed)}<span class="pd-denominator"> / ${count(p.total)}</span></strong><span>tasks completed</span></div>${progress(p.percent, "Your tasks", `${p.completed} / ${p.total}`)}<div class="pd-checklist" role="img" aria-label="${p.completed} of ${p.total} tasks complete">${Array.from({ length: Math.min(8, p.total) }, (_, i) => `<span class="${i < p.completed ? "pd-check-complete" : ""}">${icon(i < p.completed ? "check" : "close")}</span>`).join("")}</div>`
        : empty(value.empty);
    }
    if (id === "updates")
      return entries.length
        ? `<div class="pd-author"><span class="pd-mini-avatar">${icon("megaphone")}</span><span>${e(entries[0].note || "Your team")}</span></div><p class="pd-note">${e(entries[0].title)}</p>`
        : empty(value.empty);
    if (id === "texting" && value.ratio)
      return `<div class="pd-lead-number"><strong>${value.ratio.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}<span class="pd-percent">%</span></strong><span>delivered</span></div>${progress(value.ratio.percent, "Delivery", `${count(value.ratio.value)} / ${count(value.ratio.total)}`)}${
        items.length > 1
          ? `<div class="pd-two-metrics">${items
              .slice(id === "texting" ? 2 : 1)
              .map(metric)
              .join("")}</div>`
          : ""
      }`;
    if (id === "attention" && value.allClear)
      return `<div class="pd-all-clear"><span class="pd-clear-icon">${icon("check-circle")}</span><strong>All clear</strong><span>No reviews waiting</span></div>`;
    if (["attention", "replies", "files"].includes(id))
      return entries.length
        ? rows(entries, dashboardCards[id][1])
        : empty(value.empty);
    if (id === "texting")
      return `<div class="pd-lead-number"><strong>${e(count(value.activeCampaigns))}</strong><span>active campaigns</span></div><div class="pd-two-metrics">${items.slice(1).map(metric).join("")}</div>${value.partial ? `<span class="pd-subtle">Available reports${value.pausedCampaigns ? ` · ${value.pausedCampaigns} paused` : ""}</span>` : ""}`;
    const lead = items[0];
    return `${lead ? `<div class="pd-lead-number"><strong>${e(count(lead.value))}</strong><span>${e(lead.label)}</span></div>` : ""}${
      items.length > 1
        ? `<div class="pd-two-metrics">${items
            .slice(1)
            .map(
              (item, index) =>
                `<div${index ? ' class="pd-stat-divider"' : ""}>${metric(item)}</div>`,
            )
            .join("")}</div>`
        : ""
    }${entries.length ? rows(entries, dashboardCards[id][1]) : !lead ? empty(value.empty) : ""}`;
  }
  const empty = (text = "Nothing here yet") =>
    `<div class="pd-card-state"><p>${e(text)}</p></div>`;
  function renderCard(id, index, ids) {
    const [title, glyph] = dashboardCards[id],
      state = view.cards[id],
      value = state?.value;
    const wide =
      id === "activity" ||
      id === "assignment" ||
      (id === "field" && dashboardRole(view.workspace) === "field") ||
      (id === "texting" && dashboardRole(view.workspace) === "text");
    return `<article class="pd-module${wide ? " pd-wide" : ""}${id === "assignment" ? " pd-assignment" : ""}" data-dashboard-card="${id}" aria-label="${e(title)}">${view.editing ? `<div class="pd-editor-controls">${button("drag", `${icon("grip")}MOVE`, { value: id, classes: "pd-drag-handle", aria: `Drag ${title} to reorder` })}<div>${button("earlier", icon("up"), { value: id, disabled: index === 0, aria: `Move ${title} earlier` })}${button("later", icon("down"), { value: id, disabled: index === ids.length - 1, aria: `Move ${title} later` })}${button("hide", icon("close"), { value: id, aria: `Hide ${title}` })}</div></div>` : ""}<div class="pd-module-inner"><div class="pd-module-head"><div class="pd-module-title">${icon(glyph)}<h2>${e(title)}</h2></div>${value?.tag ? `<span class="pd-tag${(id === "attention" && value.knownTotal > 0) || (id === "followups" && value.metrics?.[0]?.value > 0) || (id === "replies" && value.rows?.length > 0) ? " pd-amber" : ""}">${e(value.tag)}</span>` : ""}</div>${value ? cardBody(id, value) : `<div class="pd-card-state"${state?.loading ? ' aria-busy="true"' : ""}><p>${state?.error ? "Not available right now" : "Loading…"}</p>${state?.error ? button("retry-card", "Try again", { value: id, classes: "pd-text-button" }) : ""}</div>`}</div>${value && id !== "assignment" ? button(id === "activity" ? "detail" : "navigate", `${e(value.action)}${icon("arrow")}`, { value: id === "activity" ? id : value.route, classes: "pd-module-link", disabled: view.editing }) : ""}</article>`;
  }
  function overviewCard(
    id,
    content,
    actionLabel,
    actionRoute,
    wide = false,
    actionName = "navigate",
  ) {
    const value = view.cards[id]?.value;
    const body = value
      ? content(value)
      : `<div class="pd-card-state"><p>${view.cards[id]?.error ? "Not available right now" : "Loading…"}</p>${view.cards[id]?.error ? button("retry-card", "Try again", { value: id, classes: "pd-text-button" }) : ""}</div>`;
    return `<article class="pd-module${wide ? " pd-wide" : ""}" data-dashboard-card="${id}"><div class="pd-module-inner"><div class="pd-module-title">${icon(dashboardCards[id][1])}<h2>${e(dashboardCards[id][0])}</h2></div>${body}</div>${actionRoute ? button(actionName, `${e(actionLabel)}${icon("arrow")}`, { value: actionRoute, classes: "pd-module-link" }) : ""}</article>`;
  }
  function renderOverview(page, scope) {
    const priorities = page === "priorities",
      permitted = allowed().has(priorities ? "attention" : "field");
    const header = `<div class="pd-overview-back">${button("navigate", `${icon("up")}Dashboard`, { value: scope.routes.dashboard, classes: "pd-text-button" })}${button("refresh-data", `${icon("reset")}Refresh`, { classes: "pd-text-button", disabled: view.reading })}</div><div class="pd-page-heading"><div><div class="pd-eyebrow">${priorities ? "Your next decisions" : "Current round"}</div><h1>${priorities ? "Priorities" : "Field overview"}</h1><p>${priorities ? "A clear view of what needs you." : "Your team, on the streets."}</p></div></div>`;
    let content = "";
    if (!permitted)
      content = empty(
        "This overview isn’t available with your current access.",
      );
    else if (priorities) {
      const value = view.cards.attention?.value;
      content = value
        ? `<div class="pd-priority-hero${value.allClear ? " is-clear" : ""}"><span class="pd-clear-icon">${icon(value.allClear ? "check-circle" : value.knownTotal > 0 ? "inbox" : "alert")}</span><div><strong>${value.allClear ? "All clear" : e(count(value.knownTotal))}</strong><span>${value.allClear ? "No reviews waiting" : value.unknownGroups ? "confirmed waiting" : "waiting for review"}</span></div>${value.unknownGroups ? `<span class="pd-tag">${value.unknownGroups} unavailable</span>` : ""}</div><div class="pd-priority-grid">${value.allRows.map((item) => button("navigate", `<span class="pd-icon-tile">${icon(item.value === 0 ? "check-circle" : item.icon)}</span><strong>${item.value === null ? "—" : e(count(item.value))}</strong><span>${e(item.title)}</span><small>${item.value === null ? "Unavailable" : item.value === 0 ? "All clear" : "Review"}${icon("right")}</small>`, { value: item.route, classes: `pd-priority-tile${item.value === 0 ? " is-clear" : item.value > 0 ? " is-waiting" : ""}` })).join("")}</div>${value.priorityItems?.length ? `<section class="pd-module pd-priority-items"><div class="pd-module-inner"><div class="pd-module-title">${icon("inbox")}<h2>Waiting for review</h2></div>${rows(value.priorityItems, "check-circle")}</div></section>` : ""}`
        : `<div class="pd-card-state"><p>${view.cards.attention?.error ? "Review counts are unavailable" : "Loading reviews…"}</p>${view.cards.attention?.error ? button("retry-card", "Try again", { value: "attention" }) : ""}</div>`;
    } else {
      const fieldBody = (value) =>
        `<div class="pd-field-kpis">${value.metrics.map((item) => `<div><span class="pd-icon-tile">${icon(item.label === "Doors visited" ? "footprints" : item.label === "Conversations" ? "messages" : "folder")}</span>${metric(item)}</div>`).join("")}</div>`;
      content = `<div class="pd-overview-grid">${overviewCard("field", fieldBody, "Open DoorKnocker", scope.routes.field, true)}${allowed().has("coverage") ? overviewCard("coverage", (value) => cardBody("coverage", value), "View map", scope.routes.field) : ""}${allowed().has("teams") ? overviewCard("teams", (value) => cardBody("teams", value), "View field team", "teams", false, "field-detail") : ""}${allowed().has("followups") ? overviewCard("followups", (value) => cardBody("followups", value), "View follow-ups", "followups", false, "field-detail") : ""}<article class="pd-module pd-field-actions"><div class="pd-module-inner"><span class="pd-icon-tile">${icon("signpost")}</span><h2>Ready for the next step?</h2>${button("navigate", `Open map ${icon("arrow")}`, { value: scope.routes.field, classes: "pd-button pd-primary" })}${button("navigate", `View assignments ${icon("right")}`, { value: scope.routes.missions, classes: "pd-button" })}${hasFieldManager() ? button("navigate", `Plan territories ${icon("right")}`, { value: scope.routes.territory, classes: "pd-text-button" }) : ""}</div></article></div>`;
    }
    return `<section class="organization-dashboard" aria-label="${priorities ? "Priorities overview" : "Field overview"}"><div class="pd-main">${header}<div class="pd-status" role="status">${e(view.message || "")}</div>${content}${!priorities && view.fieldDetail && allowed().has(view.fieldDetail) ? renderFieldDetail() : ""}</div></section>`;
  }
  function renderFieldDetail() {
    const value = view.cards[view.fieldDetail]?.value;
    const details = value?.details || value?.rows || [];
    const limit = view.fieldDetailLimit || 20;
    return `<section class="pd-detail" data-dashboard-field-detail tabindex="-1" aria-label="${view.fieldDetail === "teams" ? "Field team details" : "Field follow-up details"}"><div class="pd-panel-heading"><h2>${view.fieldDetail === "teams" ? "Field team" : "Open follow-ups"}</h2>${button("close-field-detail", icon("close"), { classes: "pd-close", aria: "Close field details" })}</div>${details.length ? rows(details.slice(0, limit), view.fieldDetail === "teams" ? "users" : "signpost") : empty("Nothing to show right now")}${details.length > limit ? button("more-field-details", "Show more", { classes: "pd-text-button" }) : ""}</section>`;
  }
  function hasFieldManager() {
    return (
      view.workspace?.isOwner ||
      view.workspace?.isAdmin ||
      view.workspace?.permissions?.includes("voter_map_manager")
    );
  }
  function render() {
    const scope = context();
    if (!scope || !identity()) return "";
    if (!current() || view.loading || !view.loaded)
      return `<section class="organization-dashboard" aria-label="Organization dashboard"><div class="pd-page-heading"><div><h1>Dashboard</h1></div></div><div class="pd-card-state"${view.loading || !view.error ? ' aria-busy="true"' : ""}><p>${e(view.error || "Loading your dashboard…")}</p>${view.error ? button("refresh", "Try again") : ""}</div></section>`;
    if (scope.page === "priorities" || scope.page === "field-overview")
      return renderOverview(scope.page, scope);
    const ids = visible(),
      name = String(scope.actorName || "").split(" ")[0],
      role = dashboardRole(view.workspace),
      greeting =
        clock().getHours() < 12
          ? "Good morning"
          : clock().getHours() < 18
            ? "Good afternoon"
            : "Good evening";
    const subtitle = {
      admin: "Your organization, at a glance.",
      field: "Your team, on the streets.",
      text: "Your campaigns, in focus.",
      volunteer: "Your next step starts here.",
    }[role];
    return `<section class="organization-dashboard" aria-label="Organization dashboard"><div class="pd-main"><div class="pd-page-heading"><div><div class="pd-eyebrow">${e(`${greeting}${name ? `, ${name}` : ""}`)}</div><h1>Dashboard</h1><p>${e(subtitle)}</p></div>${!view.editing ? button("customize", `${icon("customize")}Customize`, { classes: "pd-button pd-customize", disabled: view.reading }) : ""}</div><div class="pd-refresh-control">${button("refresh-data", `${icon("reset")}Refresh`, { classes: "pd-text-button", disabled: view.reading || view.editing || view.saving })}</div><div class="pd-context"><span><span class="pd-small-dot"></span>${e(clock().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</span><span class="pd-personal">${icon("lock")} ${view.editing ? "Editing your layout" : "Your personal layout"}</span></div>${view.editing ? `<section class="pd-edit-panel" aria-label="Customize your dashboard"><div class="pd-edit-description"><span class="pd-icon-tile">${icon("customize")}</span><div><strong>Make room for what matters.</strong><p>Only your dashboard changes.</p></div></div><div class="pd-edit-actions">${button("library", `${icon("plus")}Add cards`)}${button("defaults", `${icon("reset")}Role default`, { classes: "pd-button pd-quiet" })}<span class="pd-edit-spacer"></span>${button("cancel", "Cancel", { classes: "pd-button pd-quiet", disabled: view.saving })}${button("save", `${icon("check")}${view.saving ? "Saving…" : "Save layout"}`, { classes: "pd-button pd-primary", disabled: view.saving || Boolean(view.conflict) })}</div><p class="pd-reorder-help">Drag the MOVE handle, or use the arrows. Hide any card with ×.</p></section>` : ""}${view.library ? renderLibrary() : ""}${view.detail ? `<section class="pd-detail" aria-label="Organization activity details"><div class="pd-panel-heading"><h2>Organization activity</h2>${button("close-detail", icon("close"), { classes: "pd-close", aria: "Close activity" })}</div>${rows(view.cards.activity?.value?.rows || [], "activity")}</section>` : ""}<div class="pd-status" role="status" aria-live="polite">${e(view.message || "")}${view.conflict ? button("refresh", "Load latest layout", { classes: "pd-text-button" }) : ""}</div><div class="pd-grid">${ids.length ? ids.map((id, index) => renderCard(id, index, ids)).join("") : `<div class="pd-empty"><h2>A little breathing room.</h2><p>Add the cards you want to see.</p>${button("library", `${icon("plus")}Add cards`, { classes: "pd-button pd-primary" })}</div>`}</div>${!view.editing ? `<footer class="pd-footer">${button("library", `Add a card ${icon("plus")}`, { classes: "pd-text-button" })}</footer>` : ""}</div></section>`;
  }
  function renderLibrary() {
    const ids = visible();
    return `<section class="pd-library" aria-label="Available dashboard cards"><div class="pd-panel-heading"><div><h2>Your card collection</h2><p>Cards available with your current access.</p></div>${button("close-library", icon("close"), { classes: "pd-close", aria: "Close card collection" })}</div><div class="pd-catalog-grid">${cardIds
      .filter((id) => allowed().has(id))
      .map(
        (id) =>
          `<div class="pd-catalog-item"><span class="pd-icon-tile">${icon(dashboardCards[id][1])}</span><div><strong>${e(dashboardCards[id][0])}</strong><p>${e(dashboardCards[id][2])}</p></div>${button("add", icon(ids.includes(id) ? "check" : "plus"), { value: id, disabled: ids.includes(id), aria: `${ids.includes(id) ? "Added" : "Add"} ${dashboardCards[id][0]}` })}</div>`,
      )
      .join("")}</div></section>`;
  }
  function beginEdit() {
    if (view.reading) return;
    if (!view.editing) {
      view.draft = clone(view.layout);
      view.editing = true;
      view.detail = false;
    }
  }
  function reorder(id, target) {
    const order = view.draft.order,
      from = order.indexOf(id),
      to = order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, id);
    view.message = `${dashboardCards[id][0]} moved.`;
  }
  async function action(actionName, value) {
    if (!current()) return;
    if (actionName === "refresh") return load({ force: true });
    if (actionName === "refresh-data") return load({ force: true, soft: true });
    if (!view.loaded || view.saving) return;
    if (
      view.reading &&
      [
        "customize",
        "library",
        "defaults",
        "add",
        "hide",
        "earlier",
        "later",
        "save",
      ].includes(actionName)
    )
      return;
    if (actionName === "navigate") {
      if (!view.editing && value?.startsWith("/")) navigate(value);
      return;
    }
    if (
      actionName === "field-detail" &&
      ["teams", "followups"].includes(value) &&
      allowed().has(value)
    ) {
      view.fieldDetail = value;
      view.fieldDetailLimit = 20;
      focusSelector = "[data-dashboard-field-detail]";
    }
    if (actionName === "close-field-detail") view.fieldDetail = null;
    if (actionName === "more-field-details")
      view.fieldDetailLimit = (view.fieldDetailLimit || 20) + 20;
    if (actionName === "detail") {
      if (!view.editing) view.detail = true;
    }
    if (actionName === "close-detail") view.detail = false;
    if (actionName === "customize") {
      beginEdit();
      view.message = "";
    }
    if (actionName === "library") {
      beginEdit();
      view.library = !view.library;
    }
    if (actionName === "close-library") view.library = false;
    if (actionName === "cancel") {
      view.editing = false;
      view.library = false;
      view.draft = null;
      view.message = "Changes discarded.";
    }
    if (actionName === "defaults" && view.editing) {
      view.draft = defaultDashboardLayout(view.workspace);
      view.message = "Role default restored. Save layout to keep it.";
    }
    if (actionName === "hide" && view.editing && allowed().has(value)) {
      if (!view.draft.hidden.includes(value)) view.draft.hidden.push(value);
      view.message = `${dashboardCards[value][0]} hidden.`;
    }
    if (actionName === "add" && view.editing && allowed().has(value)) {
      if (!view.draft.order.includes(value)) view.draft.order.push(value);
      view.draft.hidden = view.draft.hidden.filter((id) => id !== value);
      view.message = `${dashboardCards[value][0]} added.`;
    }
    if (["earlier", "later"].includes(actionName) && view.editing) {
      const ids = visible(),
        position = ids.indexOf(value),
        target = ids[position + (actionName === "earlier" ? -1 : 1)];
      if (target) reorder(value, target);
      focusSelector = `[data-dashboard-action="${actionName}"][data-value="${value}"]`;
    }
    if (actionName === "retry-card" && allowed().has(value)) {
      delete view.cards[value];
      await loadCard(value);
      return;
    }
    if (actionName === "save" && view.editing) {
      const key = view.key,
        version = generation,
        scope = { ...context() };
      view.saving = true;
      view.message = "";
      changed();
      try {
        const saved = await call(
          `/api/organizations/${encodeURIComponent(scope.scopeType)}/${encodeURIComponent(scope.scopeId)}/dashboard-preferences`,
          {
            method: "PUT",
            headers: { "X-Polis-Expected-Actor": scope.userId },
            body: { ...view.draft, expectedRevision: view.revision },
          },
          key,
          version,
        );
        applySnapshot(saved);
        view.editing = false;
        view.library = false;
        view.draft = null;
        view.message = "Your layout is saved.";
      } catch (error) {
        if (!current(key, version)) return;
        if ([401, 403].includes(error?.status)) revoke();
        else if (error?.status === 409) {
          view.conflict = true;
          view.message = "Your layout changed on another device.";
        } else view.message = "Layout not saved. Try again.";
      } finally {
        if (current(key, version)) view.saving = false;
      }
    }
    changed();
    if (current() && view.loaded) void loadCards();
  }
  function mount(root) {
    const next = root.querySelector(".organization-dashboard");
    if (!next || next === host) return;
    if (host) {
      for (const attribute of [...host.attributes]) {
        if (!next.hasAttribute(attribute.name))
          host.removeAttribute(attribute.name);
      }
      for (const attribute of next.attributes)
        host.setAttribute(attribute.name, attribute.value);
      if (host.innerHTML !== next.innerHTML) {
        for (const oldCard of host.querySelectorAll("[data-dashboard-card]")) {
          const replacement = next.querySelector(
            `[data-dashboard-card="${oldCard.dataset.dashboardCard}"]`,
          );
          if (replacement?.outerHTML === oldCard.outerHTML)
            replacement.replaceWith(oldCard);
        }
        host.replaceChildren(...next.childNodes);
      }
      next.replaceWith(host);
      if (focusSelector) {
        host.querySelector(focusSelector)?.focus();
        focusSelector = null;
      }
      return;
    }
    host = next;
    host.addEventListener("click", (event) => {
      const control = event.target.closest("[data-dashboard-action]");
      if (!control || control.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      void action(control.dataset.dashboardAction, control.dataset.value);
    });
    host.addEventListener("pointerdown", (event) => {
      const control = event.target.closest('[data-dashboard-action="drag"]');
      if (!control || !view.editing || view.saving) return;
      drag = {
        id: control.dataset.value,
        target: control.dataset.value,
        key: view.key,
        x: event.clientX,
        y: event.clientY,
        pointer: event.pointerId,
      };
      control.setPointerCapture?.(event.pointerId);
    });
    host.addEventListener("pointermove", (event) => {
      if (!drag || !current(drag.key) || drag.pointer !== event.pointerId)
        return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6)
        return;
      event.preventDefault();
      drag.active = true;
      host
        .querySelector(`[data-dashboard-card="${drag.id}"]`)
        ?.classList.add("pd-dragging");
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-dashboard-card]");
      if (target) drag.target = target.dataset.dashboardCard;
    });
    const finish = (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const completed = drag;
      drag = null;
      if (current(completed.key) && view.editing && completed.active) {
        reorder(completed.id, completed.target);
        changed();
      }
    };
    host.addEventListener("pointerup", finish);
    host.addEventListener("pointercancel", () => {
      drag = null;
      host
        .querySelectorAll(".pd-dragging")
        .forEach((card) => card.classList.remove("pd-dragging"));
    });
    if (focusSelector) {
      host.querySelector(focusSelector)?.focus();
      focusSelector = null;
    }
  }
  return { load, resume, reset, render, mount, action, state: () => view };
}
