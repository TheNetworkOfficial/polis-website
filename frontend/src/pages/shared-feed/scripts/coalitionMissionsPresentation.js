/** Approved Missions presentation. Data, authorization, and mutations stay with the caller. */
const ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  board:
    '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="14" rx="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
};

const STATUS_LABELS = {
  active: "In progress",
  submitted: "Needs review",
  blocked: "Blocked",
  queued: "Not started",
  completed: "Completed",
  changes: "Needs changes",
  failed: "Failed",
  canceled: "Canceled",
  paused: "Paused",
};

const ADMIN_VIEWS = [
  "missions",
  "attention",
  "people",
  "templates",
  "timeline",
  "activity",
];
const MEMBER_VIEWS = ["mine", "available", "completed"];
const CLOSED_STATUSES = new Set(["completed", "failed", "canceled"]);
const ACTION = "coalition-missions-ui-";

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function icon(name) {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.arrow}</svg>`;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function presentationState(model) {
  const source =
    model.ui ||
    model.resource?.ui ||
    model.resource?.presentation ||
    model.resource ||
    {};
  const canManage = model.canManage === true;
  const allowed = canManage ? ADMIN_VIEWS : MEMBER_VIEWS;
  const legacyView = { board: "missions", audit: "activity" }[source.view];
  const requested = legacyView || source.view;
  return {
    view: allowed.includes(requested) ? requested : allowed[0],
    layout: source.layout === "board" ? "board" : "list",
    query: String(source.query || ""),
    status: String(source.status || "all"),
    assignee: String(source.assignee || "all"),
    reverseDue: source.reverseDue === true,
  };
}

function canCreate(model) {
  return model.canManage === true && model.canCreate !== false;
}

function canManageTemplates(model) {
  return model.canManage === true && model.canManageTemplates !== false;
}

function isAssignedTo(item, userId) {
  return Boolean(
    userId &&
      (item.assigneeId === userId || array(item.assigneeIds).includes(userId)),
  );
}

function hasAssignee(item) {
  return Boolean(item.assigneeId || array(item.assigneeIds).length);
}

function isAvailable(item) {
  if (Object.prototype.hasOwnProperty.call(item, "availableJobCount")) {
    const count = Number(item.availableJobCount);
    return Number.isFinite(count) && count > 0;
  }
  return item.status === "active" && !hasAssignee(item) && item.claimableRole;
}

function isUnassignedDisplay(item) {
  return (
    !hasAssignee(item) ||
    (!item.assigneeId && item.assigneeLabel === "Unassigned")
  );
}

function needsAttention(item) {
  return (
    ["submitted", "blocked", "changes"].includes(item.status) ||
    (item.overdue && !CLOSED_STATUSES.has(item.status))
  );
}

function readableName(person) {
  const name = String(person?.name || "").trim();
  return name && name !== String(person?.id || "") ? name : "Member";
}

function findPerson(model, id) {
  return array(model.people).find((person) => person.id === id);
}

function assigneeName(model, item) {
  const label = String(item.assigneeLabel || "").trim();
  if (label && label !== String(item.assigneeId || "")) return label;
  const person = findPerson(model, item.assigneeId);
  if (person) return readableName(person);
  if (array(item.assigneeIds).length > 1)
    return `${item.assigneeIds.length} people`;
  return hasAssignee(item) ? "Assigned member" : "Unassigned";
}

function initials(name) {
  return String(name || "")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function avatar(person, fallback = "") {
  const label = person
    ? String(person.initials || initials(readableName(person)))
    : initials(fallback);
  return label
    ? `<span class="avatar" aria-hidden="true">${escapeHtml(label)}</span>`
    : '<span class="avatar unassigned" aria-hidden="true">—</span>';
}

function personLabel(model, item) {
  return `<span class="person">${avatar(findPerson(model, item.assigneeId), isUnassignedDisplay(item) ? "" : assigneeName(model, item))}<span>${escapeHtml(assigneeName(model, item))}</span></span>`;
}

function statusLabel(status) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  if (!status || ["unknown", "projection_unknown"].includes(status))
    return "Status unavailable";
  const words = String(status).replace(/[_-]+/gu, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Status unavailable";
}

function statusBadge(item) {
  const label =
    isAvailable(item) && item.status === "active" && isUnassignedDisplay(item)
      ? "Available"
      : statusLabel(item.status);
  return `<span class="status-badge" data-status="${escapeHtml(item.status || "unknown")}">${escapeHtml(label)}</span>`;
}

function steps(item) {
  return array(item.steps);
}

function completedStepCount(item) {
  return steps(item).filter((step) => step.done).length;
}

function dueTimestamp(item) {
  if (!item.dueDate) return null;
  const timestamp = new Date(item.dueDate).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareDue(left, right, reverse = false) {
  const leftDue = dueTimestamp(left);
  const rightDue = dueTimestamp(right);
  if (leftDue === null || rightDue === null) {
    if (leftDue !== rightDue) return leftDue === null ? 1 : -1;
    return String(left.title || "").localeCompare(String(right.title || ""));
  }
  return (reverse ? -1 : 1) * (leftDue - rightDue);
}

/** Filtering is local to authorized records supplied by the existing Missions loader. */
export function filterCoalitionMissionItems(model) {
  const ui = presentationState(model);
  const currentUserId = model.currentUserId;
  const query = ui.query.trim().toLowerCase();
  return array(model.items)
    .filter((item) => {
      if (ui.view === "attention" && !needsAttention(item)) return false;
      if (
        ui.view === "mine" &&
        (!isAssignedTo(item, currentUserId) || item.status === "completed")
      )
        return false;
      if (ui.view === "available" && !isAvailable(item)) return false;
      if (
        ui.view === "completed" &&
        (!isAssignedTo(item, currentUserId) || item.status !== "completed")
      )
        return false;
      if (ui.status !== "all" && item.status !== ui.status) return false;
      if (ui.assignee === "mine" && !isAssignedTo(item, currentUserId))
        return false;
      if (ui.assignee === "unassigned" && !isUnassignedDisplay(item))
        return false;
      if (
        !["all", "mine", "unassigned"].includes(ui.assignee) &&
        !isAssignedTo(item, ui.assignee)
      )
        return false;
      return `${item.title || ""} ${item.project || ""} ${assigneeName(model, item)}`
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => {
      if (
        CLOSED_STATUSES.has(left.status) !== CLOSED_STATUSES.has(right.status)
      )
        return CLOSED_STATUSES.has(left.status) ? 1 : -1;
      return compareDue(left, right, ui.reverseDue);
    });
}

export function coalitionMissionPresentationTabs(model) {
  const items = array(model.items);
  if (model.canManage !== true) {
    return [
      {
        key: "mine",
        label: "My work",
        count: items.filter(
          (item) =>
            isAssignedTo(item, model.currentUserId) &&
            item.status !== "completed",
        ).length,
      },
      {
        key: "available",
        label: "Available",
        count: items.filter(isAvailable).length,
      },
      {
        key: "completed",
        label: "Completed",
        count: items.filter(
          (item) =>
            isAssignedTo(item, model.currentUserId) &&
            item.status === "completed",
        ).length,
      },
    ];
  }
  return [
    { key: "missions", label: "Missions", count: items.length },
    {
      key: "attention",
      label: "Attention",
      count: items.filter(needsAttention).length,
    },
    { key: "people", label: "People", count: array(model.people).length },
    {
      key: "templates",
      label: "Templates",
      count: array(model.templates).length,
    },
    { key: "timeline", label: "Timeline", count: null },
    { key: "activity", label: "Activity", count: null },
  ];
}

function renderTabs(model) {
  const ui = presentationState(model);
  return `<nav class="view-tabs" role="tablist" aria-label="Mission views">${coalitionMissionPresentationTabs(
    model,
  )
    .map(
      ({ key, label, count }) =>
        `<button id="coalition-missions-tab-${key}" type="button" role="tab" aria-controls="coalition-missions-view" aria-selected="${ui.view === key}" tabindex="${ui.view === key ? 0 : -1}" data-action="${ACTION}view" data-view="${key}">${label}${count === null ? "" : `<span class="count">${count}</span>`}</button>`,
    )
    .join("")}</nav>`;
}

function renderMissionRow(model, item) {
  const complete = completedStepCount(item);
  const total = steps(item).length;
  const overdue = item.overdue && !CLOSED_STATUSES.has(item.status);
  return `<article class="mission-item"><button type="button" class="mission-row" data-action="${ACTION}open" data-id="${escapeHtml(item.id)}" aria-label="Open mission: ${escapeHtml(item.title)}"><span class="mission-name"><strong>${escapeHtml(item.title)}</strong><small>${["high", "urgent"].includes(item.priority) ? '<span class="priority-mark">High priority</span> · ' : ""}${escapeHtml(item.project || "Mission")}</small></span><span>${statusBadge(item)}</span>${personLabel(model, item)}<span class="due-date${overdue ? " overdue" : ""}"><span>${escapeHtml(item.dueLabel || "No deadline")}</span>${overdue ? "<small>Overdue</small>" : ""}</span><span class="progress" aria-label="${complete} of ${total} steps complete">${icon("check")} ${complete}/${total}</span><span class="row-chevron">${icon("arrow")}</span></button></article>`;
}

function renderMissionList(model, items) {
  const ui = presentationState(model);
  return `<div class="table-header"><span>Mission</span><span>Status</span><span>Assigned to</span><button type="button" class="text-button" data-action="${ACTION}sort" aria-label="Sort by due date, ${ui.reverseDue ? "descending" : "ascending"}">Due date ${ui.reverseDue ? "↑" : "↓"}</button><span>Steps</span><span></span></div><div class="mission-list">${items.map((item) => renderMissionRow(model, item)).join("")}</div>`;
}

function renderMissionBoard(model, items) {
  const hasStoppedWork = items.some((item) =>
    ["failed", "canceled"].includes(item.status),
  );
  const columns = [
    ["queued", "Not started"],
    ["active", "In progress"],
    ["submitted", "Needs review"],
    ["completed", hasStoppedWork ? "Closed" : "Completed"],
  ];
  return `<div class="board">${columns
    .map(([key, label]) => {
      const rows = items.filter((item) =>
        key === "completed"
          ? CLOSED_STATUSES.has(item.status)
          : key === "active"
            ? !CLOSED_STATUSES.has(item.status) &&
              !["queued", "submitted"].includes(item.status)
            : item.status === key,
      );
      return `<section class="board-column"><h3>${label}<span class="count">${rows.length}</span></h3>${
        rows
          .map(
            (item) =>
              `<button type="button" class="board-card" data-action="${ACTION}open" data-id="${escapeHtml(item.id)}" aria-label="Open mission: ${escapeHtml(item.title)}">${statusBadge(item)}<strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.project || "Mission")}</small><span class="board-card-footer">${avatar(findPerson(model, item.assigneeId), isUnassignedDisplay(item) ? "" : assigneeName(model, item))}<span class="${item.overdue && !CLOSED_STATUSES.has(item.status) ? "overdue" : ""}">${escapeHtml(item.dueLabel || "No deadline")}</span></span></button>`,
          )
          .join("") || '<p class="board-empty">Nothing here yet.</p>'
      }</section>`;
    })
    .join("")}</div>`;
}

function renderListHeader(model) {
  const ui = presentationState(model);
  const titles = {
    missions: [
      "Team missions",
      "Clear ownership, visible progress, and a next step for every task.",
    ],
    attention: [
      "Needs attention",
      "Review submissions, resolve blockers, and help overdue work move forward.",
    ],
    mine: [
      "Your next steps",
      "The work assigned to you, with everything you need to move it forward.",
    ],
    available: [
      "Find your next mission",
      "Claim a mission that matches your volunteer role.",
    ],
    completed: [
      "Completed work",
      "A record of the missions you have finished.",
    ],
  };
  const [title, description] = titles[ui.view] || titles.missions;
  return `<div class="panel-header"><div class="panel-title"><h2>${title}</h2><p>${description}</p></div><div class="panel-toolbar"><div class="segmented" role="group" aria-label="Mission layout"><button type="button" data-action="${ACTION}layout" data-layout="list" aria-label="List view" aria-pressed="${ui.layout === "list"}">${icon("list")}<span>List</span></button><button type="button" data-action="${ACTION}layout" data-layout="board" aria-label="Board view" aria-pressed="${ui.layout === "board"}">${icon("board")}<span>Board</span></button></div></div></div>`;
}

function renderFilters(model) {
  const ui = presentationState(model);
  const statusOptions = new Map(Object.entries(STATUS_LABELS));
  for (const item of array(model.items)) {
    const status = String(item.status || "unknown");
    if (!statusOptions.has(status))
      statusOptions.set(status, statusLabel(status));
  }
  const filtered = Boolean(
    ui.query || ui.status !== "all" || ui.assignee !== "all",
  );
  return `<div class="filters"><label class="field search-field"><span>Find a mission</span><span class="search-input">${icon("search")}<input id="coalition-missions-query" data-missions-query type="search" placeholder="Search missions, projects, or people" value="${escapeHtml(ui.query)}" autocomplete="off" /></span></label><label class="field"><span>Status</span><select data-missions-status><option value="all">All statuses</option>${Object.entries(
    Object.fromEntries(statusOptions),
  )
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${ui.status === value ? " selected" : ""}>${escapeHtml(label)}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field"><span>${model.canManage ? "Assigned to" : "Your role"}</span>${
    model.canManage
      ? `<select data-missions-assignee><option value="all">Everyone</option><option value="mine"${ui.assignee === "mine" ? " selected" : ""}>Assigned to me</option><option value="unassigned"${ui.assignee === "unassigned" ? " selected" : ""}>Unassigned</option>${array(
          model.people,
        )
          .map(
            (person) =>
              `<option value="${escapeHtml(person.id)}"${ui.assignee === person.id ? " selected" : ""}>${escapeHtml(readableName(person))}</option>`,
          )
          .join("")}</select>`
      : `<input value="${escapeHtml(model.memberRoleLabel || "Member")}" aria-label="Your role" readonly />`
  }</label></div><div class="filter-summary"><span data-missions-summary aria-live="polite"></span><button class="text-button" type="button" data-action="${ACTION}clear"${filtered ? "" : " disabled"}>Clear filters</button></div>`;
}

function renderListEmpty(model) {
  const ui = presentationState(model);
  const filtered = ui.query || ui.status !== "all" || ui.assignee !== "all";
  const approvedEmpty = filtered || ui.view === "completed";
  const copy = approvedEmpty
    ? ["No missions found", "Try another search or clear your filters."]
    : {
        missions: [
          "No missions yet",
          canCreate(model)
            ? "Create a mission to give your team a clear next step."
            : "Missions shared with this workspace will appear here.",
        ],
        attention: [
          "Nothing needs attention",
          "New submissions and work that needs a hand will appear here.",
        ],
        mine: [
          "You’re all caught up",
          "Your next assigned mission will appear here. Check Available to find work you can claim.",
        ],
        available: [
          "No missions available",
          "Missions you can claim for your role will appear here.",
        ],
      }[ui.view] || ["No missions yet", "Missions will appear here."];
  return `<div class="empty-state">${icon(approvedEmpty ? "search" : "check")}<h3>${copy[0]}</h3><p>${copy[1]}</p>${approvedEmpty ? `<button type="button" class="secondary-button" data-action="${ACTION}clear">Clear filters</button>` : ""}</div>`;
}

/** Exported so a controller can update just results without replacing a focused search field. */
export function renderCoalitionMissionResults(model) {
  const ui = presentationState(model);
  const items = filterCoalitionMissionItems(model);
  if (model.loading && !array(model.items).length)
    return '<div class="empty-state" role="status"><h3>Loading missions…</h3><p>Your workspace is being updated.</p></div>';
  return items.length
    ? ui.layout === "board"
      ? renderMissionBoard(model, items)
      : renderMissionList(model, items)
    : renderListEmpty(model);
}

function renderListView(model) {
  const ui = presentationState(model);
  const count = filterCoalitionMissionItems(model).length;
  return `<section class="panel mission-panel">${renderListHeader(model)}${renderFilters(
    model,
  ).replace(
    '<span data-missions-summary aria-live="polite"></span>',
    `<span data-missions-summary aria-live="polite">${count} ${count === 1 ? "mission" : "missions"}${ui.view === "attention" ? " needing attention" : ""}</span>`,
  )}<div data-missions-results>${renderCoalitionMissionResults(model)}</div></section>`;
}

function renderPeople(model) {
  const people = array(model.people);
  return `<section class="panel"><div class="panel-header"><div class="panel-title"><h2>People &amp; workload</h2><p>See who has capacity and where a teammate needs a hand.</p></div></div><div class="people-grid">${
    people
      .map((person) => {
        const assigned = array(model.items).filter(
          (item) =>
            isAssignedTo(item, person.id) && !CLOSED_STATUSES.has(item.status),
        );
        return `<article class="workload-card"><div class="workload-person">${avatar(person)}<div><h3>${escapeHtml(readableName(person))}${person.id === model.currentUserId ? " <small>You</small>" : ""}</h3><p>${escapeHtml(person.role || "Member")}</p></div></div><div class="workload-metrics"><span><strong>${assigned.length}</strong>Open</span><span><strong>${assigned.filter((item) => item.status === "submitted").length}</strong>Review</span><span><strong>${assigned.filter((item) => item.status === "blocked").length}</strong>Blocked</span></div><button type="button" class="text-button" data-action="${ACTION}person" data-id="${escapeHtml(person.id)}">View missions ${icon("arrow")}</button></article>`;
      })
      .join("") ||
    '<div class="empty-state"><h3>No workload to show yet</h3><p>People and their mission assignments will appear here.</p></div>'
  }</div></section>`;
}

function renderTemplates(model) {
  const templates = array(model.templates);
  const create = canManageTemplates(model);
  return `<section class="panel"><div class="panel-header"><div class="panel-title"><h2>Mission templates</h2><p>Start with a proven checklist, then make it your own.</p></div>${create ? `<button type="button" class="secondary-button" data-action="${ACTION}new-template"${model.pending ? " disabled" : ""}>${icon("plus")} New template</button>` : ""}</div>${model.templatesError ? `<div class="note-box" role="status">${escapeHtml(model.templatesError)}</div>` : ""}<div class="template-grid">${
    templates
      .map(
        (template) =>
          `<article class="template-card"><div class="template-meta"><span>${escapeHtml(template.category || "Mission template")}</span><span>${template.version ? `Version ${escapeHtml(template.version)}` : "Ready to use"}</span></div><h3>${escapeHtml(template.title)}</h3><p>${escapeHtml(template.description || "A reusable starting point for your team’s next mission.")}</p><div class="template-footer"><span>${array(template.steps).length} steps${template.targetRole ? ` · ${escapeHtml(template.targetRole)}` : ""}</span><div class="note-actions">${create ? `<button type="button" class="icon-button" data-action="${ACTION}edit-template" data-id="${escapeHtml(template.id)}" aria-label="Edit template: ${escapeHtml(template.title)}">${icon("edit")}</button>` : ""}${canCreate(model) ? `<button type="button" class="text-button" data-action="${ACTION}use-template" data-id="${escapeHtml(template.id)}"${model.pending ? " disabled" : ""}>Use template ${icon("arrow")}</button>` : ""}</div></div></article>`,
      )
      .join("") ||
    `<div class="empty-state"><h3>${model.templatesLoading ? "Loading templates…" : "No templates yet"}</h3><p>${create ? "Save a reusable checklist for the next mission." : "Templates shared with this workspace will appear here."}</p></div>`
  }</div></section>`;
}

function timelineDate(item) {
  const timestamp = dueTimestamp(item);
  if (timestamp === null) return "undated";
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function renderTimeline(model) {
  const items = array(model.items)
    .filter((item) => !CLOSED_STATUSES.has(item.status))
    .slice()
    .sort(compareDue);
  const dates = [...new Set(items.map(timelineDate))];
  const dated = dates.filter((date) => date !== "undated").sort();
  const first = dated.length ? new Date(`${dated[0]}T12:00:00`) : null;
  const last = dated.length ? new Date(`${dated.at(-1)}T12:00:00`) : null;
  const sameYear = first && last && first.getFullYear() === last.getFullYear();
  const sameMonth = sameYear && first.getMonth() === last.getMonth();
  const dateFormat = {
    month: "long",
    day: "numeric",
    ...(!sameYear ? { year: "numeric" } : {}),
  };
  const range = !first
    ? "No deadlines"
    : dated.length === 1
      ? first.toLocaleDateString("en-US", dateFormat)
      : `${first.toLocaleDateString("en-US", dateFormat)}–${sameMonth ? last.getDate() : last.toLocaleDateString("en-US", dateFormat)}`;
  return `<section class="panel"><div class="panel-header"><div class="panel-title"><h2>Timeline</h2><p>A shared view of deadlines and the work that depends on them.</p></div><span class="role-pill">${escapeHtml(range)}</span></div><div class="timeline-list">${
    dates
      .map((date) => {
        const label =
          date === "undated"
            ? "No deadline"
            : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              });
        return `<section class="timeline-day"><h3>${escapeHtml(label)}</h3>${items
          .filter((item) => timelineDate(item) === date)
          .map(
            (item) =>
              `<button type="button" class="timeline-row" data-action="${ACTION}open" data-id="${escapeHtml(item.id)}"><span class="timeline-marker" data-status="${escapeHtml(item.status)}"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(array(item.dependencies).length ? `After: ${item.dependencies[0]}` : item.project || "Mission")}</small></span>${statusBadge(item)}<span class="row-chevron">${icon("arrow")}</span></button>`,
          )
          .join("")}</section>`;
      })
      .join("") ||
    '<div class="empty-state"><h3>No upcoming work</h3><p>Mission deadlines and dependencies will appear here.</p></div>'
  }</div></section>`;
}

function renderActivity(model) {
  const events = array(model.events);
  return `<section class="panel"><div class="panel-header"><div class="panel-title"><h2>Activity</h2><p>The latest assignments, submissions, decisions, and updates.</p></div></div><div class="activity-list">${
    events
      .map((event) => {
        const person = array(model.people).find(
          (candidate) =>
            candidate.id === event.actorId ||
            readableName(candidate) === event.actor,
        );
        const title = array(model.items).find(
          (item) => item.id === event.missionId,
        )?.title;
        const suppliedName = String(event.actor || "").trim();
        const name = person
          ? readableName(person)
          : suppliedName &&
              suppliedName !== event.actorId &&
              !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(suppliedName)
            ? suppliedName
            : "A teammate";
        return `<article class="activity-item">${avatar(person, name)}<div><p><strong>${escapeHtml(name)}</strong> ${escapeHtml(event.action || "updated a mission")}</p>${event.missionId ? `<button type="button" class="text-button" data-action="${ACTION}open" data-id="${escapeHtml(event.missionId)}">${escapeHtml(title || "View mission")}</button>` : ""}<small>${escapeHtml(event.time || "Recently")}</small></div></article>`;
      })
      .join("") ||
    '<div class="empty-state"><h3>No activity yet</h3><p>Mission updates and decisions will appear here.</p></div>'
  }</div></section>`;
}

function renderDialogs(model) {
  const detail = model.detailId
    ? `<dialog class="drawer" id="coalition-mission-detail" aria-label="Mission details" data-missions-dialog="detail">${
        model.detailLoading
          ? `<header class="dialog-header"><span class="eyebrow">Mission</span><button type="button" class="icon-button" data-action="${ACTION}close-detail" aria-label="Close mission details">${icon("close")}</button></header><div class="dialog-body"><h2>Loading mission…</h2><p role="status">Your mission details are being updated.</p></div>`
          : model.detailHtml ||
            `<header class="dialog-header"><span class="eyebrow">Mission</span><button type="button" class="icon-button" data-action="${ACTION}close-detail" aria-label="Close mission details">${icon("close")}</button></header><div class="dialog-body"><h2>Mission unavailable</h2><p>Refresh the workspace and try again.</p></div>`
      }</dialog>`
    : "";
  const create =
    model.createOpen && canCreate(model)
      ? `<dialog class="create-dialog" id="coalition-missions-create" aria-labelledby="coalition-missions-create-title" data-missions-dialog="create"><header class="dialog-header"><div><span class="eyebrow">${escapeHtml(model.scopeName || "Coalition mission")}</span><h2 id="coalition-missions-create-title">New mission</h2><p>Define a clear outcome and who can move it forward.</p></div><button class="icon-button" type="button" data-action="${ACTION}close-create" aria-label="Close mission form">${icon("close")}</button></header>${model.createHtml || ""}</dialog>`
      : "";
  const template =
    model.templateEditorOpen && canManageTemplates(model)
      ? `<dialog class="create-dialog" id="coalition-missions-template-editor" aria-labelledby="coalition-missions-template-title" data-missions-dialog="template"><header class="dialog-header"><div><span class="eyebrow">Reusable mission</span><h2 id="coalition-missions-template-title">${escapeHtml(model.templateEditorTitle || "New template")}</h2><p>Give the next mission a useful starting point.</p></div><button class="icon-button" type="button" data-action="${ACTION}close-template" aria-label="Close template form">${icon("close")}</button></header>${model.templateEditorHtml || ""}</dialog>`
      : "";
  return detail + create + template;
}

/** The caller supplies only authenticated data and trusted form/detail renderer fragments. */
export function renderCoalitionMissionsPresentation(model = {}) {
  const ui = presentationState(model);
  const renderers = {
    people: renderPeople,
    templates: renderTemplates,
    timeline: renderTimeline,
    activity: renderActivity,
  };
  const renderView = renderers[ui.view] || renderListView;
  return `<div class="polis-missions" data-missions-context="${escapeHtml(model.contextKey || model.scopeId || "")}" data-missions-revision="${escapeHtml(model.detailRevision ?? "")}" aria-busy="${model.loading === true}"><div class="page-intro"><p>Keep your team moving. Give every mission a clear next step.</p>${canCreate(model) ? `<button class="primary-button" type="button" data-action="${ACTION}create"${model.pending ? " disabled" : ""}>${icon("plus")} New mission</button>` : ""}</div>${renderTabs(model)}${model.error ? `<div class="note-box" role="alert">${escapeHtml(model.error)}</div>` : ""}<div id="coalition-missions-view" role="tabpanel" aria-labelledby="coalition-missions-tab-${ui.view}" tabindex="-1">${renderView(model)}</div>${renderDialogs(model)}</div>`;
}
