import { icon } from "./coalitionCalendarIcons.js";
import {
  calendarTypes as types,
  calendarStatuses as statuses,
  calendarText as text,
  calendarEscape as esc,
  calendarRows as rows,
  calendarZone,
  calendarLocal,
  calendarDay as date,
  calendarDayKey as key,
  calendarAddDays as addDays,
  calendarDateLabel as fmt,
  calendarFullDate as fullDate,
  calendarTime as time,
  calendarItem,
  calendarDuration as duration,
  calendarLastDay as lastDay,
  calendarConnection,
  calendarWriteTargets,
  calendarPermissions,
  calendarCreateBody,
} from "./coalitionCalendarModel.js";

/** Persistent organization-scoped Calendar; every request is fenced by actor,
 * credential, workspace and navigation generation. */
export function createCoalitionCalendar({
  context,
  request,
  navigate,
  onContextInvalidated = () => {},
  onItems = () => {},
} = {}) {
  let host,
    observer,
    focusSnapshot,
    toastTimer,
    flight,
    loadSequence = 0,
    generation = 0;
  const current = () => context?.() || null;
  const identity = (c = current()) =>
    c?.userId && c?.sessionKey && c?.coalitionId
      ? `${c.userId}|${c.sessionKey}|${c.coalitionId}`
      : "";
  const fresh = () => ({
    key: "",
    zone: calendarZone(),
    items: [],
    connections: [],
    connectionsError: "",
    condition: "loading",
    tab: "schedule",
    view: "month",
    selected: "",
    anchor: "",
    query: "",
    type: "all",
    status: "all",
    from: "",
    to: "",
    loaded: false,
    limited: "",
    pending: false,
    saveUncertain: false,
    notice: "",
    opener: null,
  });
  let state = fresh(),
    today = "";
  const q = (selector) => host?.querySelector(selector);
  const $ = q;
  const canView = () => calendarPermissions(current()?.membership).view;
  const canManage = () => calendarPermissions(current()?.membership).manage;
  const endpoint = (suffix = "") =>
    `/api/coalitions/${encodeURIComponent(current().coalitionId)}/calendar${suffix}`;
  const zoneLabel = () =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: state.zone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(Date.now())
      .find((p) => p.type === "timeZoneName")?.value || state.zone;
  const formatInstant = (value) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: state.zone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  const connectionReady = (c) =>
    ["connected", "active"].includes(c.status) && !c.error;
  const connectionStatus = (c) =>
    connectionReady(c) ? "Connected" : "Needs attention";
  const writeTargets = () =>
    state.connectionsError ? [] : calendarWriteTargets(state.connections);
  const targetLabel = (target) =>
    writeTargets().find(
      (entry) =>
        entry.provider === target.provider &&
        entry.calendarId === target.calendarId,
    )?.label || `${target.provider || "Connected calendar"} · Calendar`;
  const sourceLabel = (item) =>
    item.provider
      ? {
          google: "Google Calendar",
          microsoft: "Microsoft Outlook",
          apple: "Apple Calendar",
        }[item.provider] || "Connected calendar"
      : item.source === "provider"
        ? "Connected calendar"
        : "Polis calendar";
  const kind = (e) =>
    e.type === "volunteer_shift"
      ? "shift"
      : [
            "campaign_event",
            "scheduled_promotion",
            "public_booking",
            "coalition_shared",
          ].includes(e.type)
        ? "event"
        : ["appointment", "meeting_request", "office_hours"].includes(e.type)
          ? "meeting"
          : "other";
  const dot = (e) =>
    `<span class="type-dot" data-kind="${kind(e)}" aria-hidden="true"></span>`;
  const badge = (label, tone = "neutral") =>
    `<span class="calendar-badge" data-tone="${tone}">${esc(label)}</span>`;
  const btn = (label, action, extra = "", primary = false) =>
    `<button type="button" class="${primary ? "primary-button" : "secondary-button"}" data-cal-action="${action}" ${extra}>${label}</button>`;
  function toast(message) {
    clearTimeout(toastTimer);
    state.notice = message;
    const node = q("[data-cal-toast]");
    if (node) {
      node.textContent = message;
      node.hidden = false;
    }
    toastTimer = setTimeout(() => {
      if (node) node.hidden = true;
    }, 5000);
  }
  function visibleItems() {
    if (state.condition === "empty") return [];
    return state.items
      .filter(
        (e) =>
          (state.type === "all" || e.type === state.type) &&
          (state.status === "all" || e.status === state.status) &&
          `${e.title} ${e.location} ${e.description} ${e.labels.join(" ")}`
            .toLowerCase()
            .includes(state.query.trim().toLowerCase()),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  function onDay(day) {
    return visibleItems().filter(
      (e) => e.start.slice(0, 10) <= day && lastDay(e) >= day,
    );
  }
  function range() {
    const d = date(state.anchor);
    if (state.view === "agenda") {
      const first = key(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
      );
      return [
        state.from ||
          (state.anchor.slice(0, 7) === today.slice(0, 7) ? today : first),
        state.to ||
          key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))),
      ];
    }
    if (state.view === "week") {
      const first = addDays(state.anchor, -((d.getUTCDay() + 6) % 7));
      return [first, addDays(first, 6)];
    }
    return [
      key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
      key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))),
    ];
  }
  function currentItems() {
    const [from, to] = range();
    return visibleItems().filter(
      (e) => e.start.slice(0, 10) <= to && lastDay(e) >= from,
    );
  }
  function selectionTitle() {
    if (state.view === "agenda" && (state.from || state.to)) {
      const [a, b] = range();
      return `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (state.view === "week") {
      const [a, b] = range();
      return `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return fmt(state.anchor, { month: "long", year: "numeric" });
  }
  function renderShell() {
    if (!host) return;
    if (!q("[data-cal-content]"))
      host.innerHTML = `<header class="page-heading"><div><h1>Calendar</h1><p class="calendar-subtitle"></p></div><div class="heading-actions"><span class="role-pill" data-cal-role></span><button class="primary-button calendar-new-item" type="button" data-cal-action="new-item" aria-label="New calendar item">${icon("plus")}<span class="new-item-label">New calendar item</span></button></div></header><section class="calendar-page" aria-label="Organization Calendar"><nav class="view-tabs" id="view-tabs" role="tablist" aria-label="Calendar sections"></nav><div id="view-content" class="calendar-view-content" data-cal-content role="tabpanel"></div></section><dialog class="drawer" id="detail-dialog" data-cal-dialog="detail" aria-labelledby="detail-title"></dialog><dialog class="create-dialog" id="create-dialog" data-cal-dialog="create" aria-labelledby="create-title"></dialog><div class="toast" role="status" data-cal-toast hidden></div>`;
    host.dataset.calendarView =
      state.tab === "schedule" ? state.view : "connections";
    host.dataset.calendarCondition = state.condition;
    q(".calendar-subtitle").textContent =
      `${current()?.name || "Organization"} · Your team’s time, in one place.`;
    q("[data-cal-role]").textContent = current()?.membership?.isAdmin
      ? "Admin"
      : canManage()
        ? "Manager"
        : "Member";
    q('[data-cal-action="new-item"]').hidden =
      !canManage() || ["loading", "error", "denied"].includes(state.condition);
    q("#view-tabs").innerHTML = [
      ["schedule", "Schedule"],
      ["connections", "Connections"],
    ]
      .map(
        ([id, label]) =>
          `<button type="button" id="cal-tab-${id}" role="tab" data-cal-action="tab" data-tab="${id}" aria-selected="${state.tab === id}" aria-controls="view-content" tabindex="${state.tab === id ? 0 : -1}">${label}</button>`,
      )
      .join("");
    q("#view-content").setAttribute("aria-labelledby", `cal-tab-${state.tab}`);
  }

  function empty(title, body, action = "") {
    return `<div class="empty-state">${icon("calendar")}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
  }
  function blocking() {
    if (state.condition === "loading")
      return `<div class="calendar-loading" role="status"><span class="loading-ring"></span><h3>Loading your calendar</h3><p>Bringing your team’s schedule together.</p><div class="skeleton-grid">${Array.from({ length: 21 }, () => "<span></span>").join("")}</div>`;
    if (state.condition === "error")
      return empty(
        "Calendar unavailable",
        state.error ||
          "Your schedule could not be loaded. Try again in a moment.",
        btn("Try again", "retry"),
      );
    if (state.condition === "denied")
      return empty(
        "Calendar access required",
        "Ask an organization administrator for permission to view this calendar.",
      );
    return "";
  }
  function render() {
    if (!host) return;
    const datesOpen = q(".agenda-date-range")?.open;
    const active = host.contains(document.activeElement)
      ? document.activeElement
      : null;
    const focus = active?.id
      ? {
          id: active.id,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : null;
    renderShell();
    if (state.tab === "connections") {
      renderConnections();
      return;
    }
    $("#view-content").innerHTML =
      `<section class="panel calendar-panel" aria-label="Team calendar"><div class="calendar-toolbar"><div class="month-nav"><h2 id="range-title">${selectionTitle()}</h2><div class="date-controls"><button type="button" class="icon-button" data-cal-action="previous" aria-label="Previous ${state.view === "week" ? "week" : "month"}">${icon("chevronDown")}</button><button type="button" class="icon-button" data-cal-action="next" aria-label="Next ${state.view === "week" ? "week" : "month"}">${icon("chevronDown")}</button>${btn("Today", "today")}<button type="button" class="icon-button" data-cal-action="refresh" aria-label="Refresh calendar"${["denied", "loading"].includes(state.condition) ? " disabled" : ""}>${icon("refresh")}</button></div></div><div class="view-switch" aria-label="Calendar view">${["month", "week", "agenda"].map((v) => `<button type="button" data-cal-action="view" data-view="${v}" aria-pressed="${state.view === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div></div><div class="calendar-filters"><label class="field search-field"><span>Find a calendar item</span><div>${icon("search")}<input id="calendar-search" data-cal-search type="search" placeholder="Search events, places, or labels" value="${esc(state.query)}" /></div></label><label class="field"><span>Type</span><select id="type-filter" data-cal-type><option value="all">All types</option>${Object.entries(
        types,
      )
        .map(
          ([id, label]) =>
            `<option value="${id}"${state.type === id ? " selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="field"><span>Status</span><select id="status-filter" data-cal-status><option value="all">All statuses</option>${Object.entries(
        statuses,
      )
        .map(
          ([id, label]) =>
            `<option value="${id}"${state.status === id ? " selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label><button type="button" class="secondary-button mobile-filter-toggle" data-cal-action="toggle-filters" aria-expanded="${host.classList.contains("calendar-filters-open")}">Filters</button></div>${state.view === "agenda" ? `<details class="agenda-date-range"><summary>Dates · ${fmt(range()[0], { month: "short", day: "numeric" })}–${fmt(range()[1], { month: "short", day: "numeric" })}</summary><div class="agenda-range-controls"><label class="field"><span>From</span><input type="date" id="agenda-from" data-cal-from value="${range()[0]}" /></label><label class="field"><span>Through</span><input type="date" id="agenda-to" data-cal-to value="${range()[1]}" /></label><button type="button" class="text-button" data-cal-action="whole-month">Show whole month</button></div></details>` : ""}<div class="filter-summary"><span id="result-count" role="status"></span><button type="button" class="text-button" data-cal-action="clear-filters">Clear filters</button></div>${state.limited ? `<div class="note-box calendar-limit-notice" role="status">${esc(state.limited)}</div>` : ""}<div id="calendar-results"></div><footer class="calendar-footer"><div class="calendar-legend" aria-label="Calendar item categories">${[
        ["event", "Events"],
        ["shift", "Volunteer shifts"],
        ["meeting", "Meetings & appointments"],
        ["other", "Other"],
      ]
        .map(
          ([k, t]) =>
            `<span><i class="type-dot" data-kind="${k}"></i>${t}</span>`,
        )
        .join(
          "",
        )}</div><div class="calendar-footer-actions">${current()?.fieldAccess ? btn("Field events", "destination", 'data-destination="Field events"') + btn("Transportation", "destination", 'data-destination="Transportation"') : ""}<span>${esc(zoneLabel())}</span></div></footer></section><div class="calendar-handoffs"${state.condition === "denied" ? " hidden" : ""}><div><h3>Planning a field event?</h3><p>Coordinate the event and rides, then manage territories in Field work.</p></div><div>${btn("Field events " + icon("arrow"), "destination", 'data-destination="Field events"')}${btn("Transportation " + icon("arrow"), "destination", 'data-destination="Transportation"')}</div></div>`;
    renderResults();
    if (datesOpen && q(".agenda-date-range"))
      q(".agenda-date-range").open = true;
    const restored = focus && q(`#${focus.id}`);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (
        typeof focus.start === "number" &&
        typeof restored.setSelectionRange === "function"
      )
        restored.setSelectionRange(focus.start, focus.end);
    }
  }
  function renderResults() {
    $("#range-title").textContent = selectionTitle();
    if ($(".agenda-date-range summary"))
      $(".agenda-date-range summary").textContent =
        `Dates · ${fmt(range()[0], { month: "short", day: "numeric" })}–${fmt(range()[1], { month: "short", day: "numeric" })}`;
    const blocked = blocking();
    $("#result-count").textContent = blocked
      ? ""
      : `${currentItems().length} ${state.limited ? "loaded items" : "items"} ${state.view === "agenda" ? "in this date range" : `in this ${state.view === "week" ? "week" : "month"}`}`;
    if (state.view === "agenda" && range()[1] < range()[0]) {
      $("#calendar-results").innerHTML = empty(
        "Check your date range",
        "The through date must be on or after the from date.",
      );
      return;
    }
    if (blocked) {
      $("#calendar-results").innerHTML = blocked;
      return;
    }
    const noItems = state.condition === "empty";
    if (noItems) {
      $("#calendar-results").innerHTML = empty(
        "A clear calendar. A new beginning.",
        "Add your first event, shift, or reminder to bring the team’s plans together.",
        canManage() ? btn("New calendar item", "new-item", "", true) : "",
      );
      return;
    }
    if (
      !currentItems().length &&
      (state.query || state.type !== "all" || state.status !== "all")
    ) {
      $("#calendar-results").innerHTML = empty(
        state.limited
          ? "No matching loaded calendar items"
          : "No matching calendar items",
        state.limited
          ? "Calendar results may be incomplete. Refresh or choose a smaller date range."
          : "Try another search or clear the filters to see the full schedule.",
        btn("Clear filters", "clear-filters"),
      );
      return;
    }
    $("#calendar-results").innerHTML =
      state.view === "month"
        ? `<div class="calendar-layout"><div class="month-grid" aria-label="${selectionTitle()}">${renderMonth()}</div>${renderDay()}</div>`
        : state.view === "week"
          ? renderWeek()
          : renderAgenda();
    const grid = $(".month-grid");
    if (grid) grid.dataset.weeks = String((grid.children.length - 7) / 7);
    requestAnimationFrame(fitMonth);
  }
  function showDay() {
    openDialog(
      "#detail-dialog",
      `${header(fullDate(state.selected), "detail-title")}<div class="dialog-body selected-day-body">${renderDay()}</div><footer class="dialog-footer">${btn("Back to calendar", "close")}</footer>`,
    );
  }
  function fitMonth() {
    const grid = $(".month-grid");
    if (!grid) return;
    grid.dataset.weeks = String((grid.children.length - 7) / 7);
    for (const cell of grid.querySelectorAll(".day-cell")) {
      const count = onDay(cell.querySelector(".day-number").dataset.day).length;
      const chips = [...cell.querySelectorAll(".calendar-event")];
      const available = cell.clientHeight - 36;
      const chipHeight = chips[0]
        ? Math.max(22, chips[0].getBoundingClientRect().height)
        : 22;
      const limit =
        innerWidth <= 760
          ? 0
          : Math.max(0, Math.min(3, Math.floor(available / (chipHeight + 3))));
      chips.forEach((chip, i) => (chip.hidden = i >= limit));
      const more = cell.querySelector(".more-events");
      if (more) {
        more.hidden = innerWidth <= 760 || count <= limit;
        more.textContent = `+${Math.max(0, count - limit)}`;
      }
    }
  }
  function eventChip(e) {
    return `<button type="button" class="calendar-event${e.status === "canceled" ? " is-cancelled" : ""}" data-cal-action="item" data-id="${esc(e.id)}" data-kind="${kind(e)}" aria-label="${esc(`${e.title}, ${duration(e)}, ${statuses[e.status]}`)}">${dot(e)}<span class="event-time">${e.allDay ? "All day" : time(e.start).replace(":00", "").replace(" AM", "a").replace(" PM", "p")}</span><span class="event-title">${esc(e.title)}</span>${e.status === "pending_approval" ? '<span class="pending-mark" title="Pending">○</span>' : ""}</button>`;
  }
  function renderMonth() {
    const d = date(state.anchor);
    const first = key(
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    );
    const start = addDays(first, -((date(first).getUTCDay() + 6) % 7));
    const last = key(
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)),
    );
    const count =
      Math.ceil(
        (((date(first).getUTCDay() + 6) % 7) + date(last).getUTCDate()) / 7,
      ) * 7;
    return (
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .map((day) => `<div class="weekday-label">${day}</div>`)
        .join("") +
      Array.from({ length: count }, (_, i) => {
        const day = addDays(start, i);
        const items = onDay(day);
        return `<div class="day-cell${day === state.selected ? " selected" : ""}${day === today ? " today" : ""}${day.slice(0, 7) !== first.slice(0, 7) ? " outside" : ""}"><button type="button" class="day-number" data-cal-action="select-day" data-day="${day}" aria-label="${fullDate(day)}${items.length ? `, ${items.length} items` : ""}" aria-pressed="${day === state.selected}"${day === today ? ' aria-current="date"' : ""}>${date(day).getUTCDate()}</button><div class="day-chips">${items.slice(0, 3).map(eventChip).join("")}</div><span class="mobile-dots" aria-hidden="true">${items.slice(0, 4).map(dot).join("")}</span>${items.length ? `<button type="button" class="more-events" data-cal-action="select-day" data-day="${day}" aria-label="View all ${items.length} items on ${fullDate(day)}" hidden></button>` : ""}</div>`;
      }).join("")
    );
  }
  function eventCard(e, cls = "day-event") {
    return `<button type="button" class="${cls}${e.status === "canceled" ? " is-cancelled" : ""}" data-cal-action="item" data-id="${esc(e.id)}" data-kind="${kind(e)}"><span class="event-card-type">${dot(e)}${esc(types[e.type])}</span><strong>${esc(e.title)}</strong><span>${icon("clock")}${duration(e)}</span>${e.location ? `<span>${icon("pin")}${esc(e.location)}</span>` : ""}${e.status !== "confirmed" ? badge(statuses[e.status], e.status === "pending_approval" ? "warning" : "neutral") : ""}</button>`;
  }
  function overlap(items) {
    const scheduled = items.filter(
      (e) => !e.allDay && !["canceled", "denied"].includes(e.status),
    );
    return scheduled.some((e, i) =>
      scheduled.some(
        (other, j) => j > i && e.start < other.end && e.end > other.start,
      ),
    );
  }
  function renderDay() {
    const items = onDay(state.selected);
    return `<aside class="day-agenda" aria-label="Selected day"><header><span class="eyebrow">${state.selected === today ? "Today" : fmt(state.selected, { weekday: "long" })}</span><h3>${fmt(state.selected, { month: "long", day: "numeric" })}</h3><p>${items.length} ${state.limited ? (items.length === 1 ? "loaded item" : "loaded items") : items.length === 1 ? "item" : "items"} on the schedule</p></header><div class="day-events">${items.length ? items.map((e) => eventCard(e)).join("") : `<p class="quiet-day">${state.limited ? "No loaded items for this day. Calendar results may be incomplete." : "Nothing scheduled. A little room for what comes next."}</p>`}</div>${overlap(items) ? `<div class="overlap-note">${icon("info")}<span>Some times overlap. Check the details before making plans.</span></div>` : ""}${canManage() ? btn(icon("plus") + " Add to this day", "new-item", `data-day="${state.selected}"`) : ""}</aside>`;
  }
  function renderWeek() {
    const [first] = range();
    return `<div class="week-grid">${Array.from({ length: 7 }, (_, i) => {
      const day = addDays(first, i),
        items = onDay(day);
      return `<section class="week-day${day === today ? " today" : ""}"><header><span>${fmt(day, { weekday: "short" })}</span><strong>${fmt(day, { month: "short", day: "numeric" })}</strong><small>${items.length} ${state.limited ? (items.length === 1 ? "loaded item" : "loaded items") : items.length === 1 ? "item" : "items"}</small></header>${items.map((e) => eventCard(e, "event-card")).join("") || `<p class="quiet-day">${state.limited ? "No loaded items" : "No items"}</p>`}${canManage() ? `<button type="button" class="text-button" data-cal-action="new-item" data-day="${day}" aria-label="Add item on ${fullDate(day)}">${icon("plus")} Add item</button>` : ""}</section>`;
    }).join("")}</div>`;
  }
  function renderAgenda() {
    const groups = Map.groupBy(currentItems(), (e) =>
      e.start.slice(0, 10) < range()[0] ? range()[0] : e.start.slice(0, 10),
    );
    if (!groups.size)
      return empty(
        state.limited
          ? "No loaded items in this date range"
          : "Nothing scheduled this month",
        state.limited
          ? "Calendar results may be incomplete. Refresh or choose a smaller date range."
          : "Use the arrows to explore another month, or return to today.",
        btn("Go to today", "today"),
      );
    return `<div class="agenda-list">${[...groups].map(([day, items]) => `<section class="agenda-group"><header class="agenda-date${day === today ? " today" : ""}"><strong>${fmt(day, { weekday: "short", month: "short", day: "numeric" })}</strong>${day === today ? badge("Today", "primary") : ""}<span>${items.length} ${state.limited ? (items.length === 1 ? "loaded item" : "loaded items") : items.length === 1 ? "item" : "items"}</span></header>${items.map((e) => `<button type="button" class="agenda-row${e.status === "canceled" ? " is-cancelled" : ""}" data-cal-action="item" data-id="${esc(e.id)}"><span class="agenda-time">${e.allDay ? "All day" : time(e.start)}<small>${e.allDay ? "" : time(e.end)}</small></span><span class="agenda-item">${dot(e)}<span><strong>${esc(e.title)}</strong><small>${esc(e.location || "No location added")}${e.start.slice(0, 10) !== lastDay(e) ? ` · ${fmt(e.start, { month: "short", day: "numeric" })}–${fmt(lastDay(e), { month: "short", day: "numeric" })}` : ""}</small></span></span><span class="agenda-type">${esc(types[e.type])}</span>${badge(statuses[e.status], e.status === "pending_approval" ? "warning" : e.status === "confirmed" ? "success" : "neutral")}${icon("arrow")}</button>`).join("")}</section>`).join("")}</div>`;
  }
  function renderConnections() {
    const blocked = blocking();
    q("#view-content").innerHTML =
      `<section class="panel"><div class="panel-header"><div><h2>Connected calendars</h2><p>See where calendar items come from and which calendars can receive new items.</p></div></div>${blocked || `${state.connectionsError ? empty("Connections unavailable", state.connectionsError, btn("Try again", "refresh")) : !state.connections.length ? empty("No calendars connected", "Items added in Polis still appear on your team’s schedule.") : `<div class="connections-grid">${state.connections.map((c) => `<button type="button" class="connection-card" data-cal-action="connection" data-id="${esc(c.id)}"><span class="connection-icon">${esc(c.providerLabel.slice(0, 1))}</span><div><h3>${esc(c.providerLabel)}</h3><p>${esc(c.account)}</p></div>${badge(connectionStatus(c), connectionReady(c) ? "success" : "warning")}<p class="connection-description">${esc(c.calendars.map((x) => x.title).join(" · ") || "Connected calendar account")}</p><div class="connection-capabilities"><span>${icon("calendar")}${c.calendars.some((x) => x.imported) ? "Imports items" : "Import disabled"}</span><span>${c.calendars.some((x) => x.writable) && connectionReady(c) ? icon("check") : "—"}${c.calendars.some((x) => x.writable) && connectionReady(c) ? "Available for new items" : "Import only"}</span></div><footer><small>Last synced ${c.lastSyncAt ? formatInstant(c.lastSyncAt) : "Not synced yet"}</small>${icon("arrow")}</footer></button>`).join("")}</div>`}<div class="connections-note">${icon("info")}<p>Connection details are available here. If a calendar needs attention, ask the administrator who connected it to check its account access.</p></div>`}</section>`;
  }

  function header(title, id, subtitle = "") {
    return `<header class="dialog-header"><div><span class="eyebrow">${esc(current()?.name || "Organization")}</span><h2 id="${id}">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button type="button" class="icon-button" data-cal-action="close" aria-label="Close dialog">${icon("close")}</button></header>`;
  }
  function openDialog(id, html) {
    const el = $(id);
    if (!el) return;
    state.opener = document.activeElement;
    el.innerHTML = html;
    if (!el.open) el.showModal();
  }
  function showItem(id) {
    const e = state.items.find((e) => e.id === id);
    if (!e) return;
    openDialog(
      "#detail-dialog",
      `${header(e.title, "detail-title")}<div class="dialog-body"><div class="detail-badges">${badge(types[e.type], "primary")}${badge(statuses[e.status], e.status === "pending_approval" ? "warning" : "neutral")}</div>${e.status === "canceled" ? '<div class="note-box">This item has been cancelled.</div>' : ""}<dl class="detail-meta"><div><dt>Date</dt><dd>${fullDate(e.start)}</dd></div><div><dt>Time · ${esc(zoneLabel())}</dt><dd>${duration(e)}${e.start.slice(0, 10) !== e.end.slice(0, 10) ? `<br />Ends ${fullDate(e.allDay ? lastDay(e) : e.end)}` : ""}</dd></div><div class="full-width"><dt>Location</dt><dd>${esc(e.location || "No location added")}</dd></div><div><dt>Source</dt><dd>${esc(sourceLabel(e))}</dd></div><div><dt>Calendar display</dt><dd>${e.privacy === "busy_only" ? "Busy only" : "Show details"}</dd></div></dl><section class="detail-section"><h3>About this item</h3><p>${esc(e.description || "No description added.")}</p></section>${e.externalWriteTargets?.length ? `<section class="detail-section"><h3>Calendar destinations</h3><p>${e.externalWriteTargets.map((target) => esc(targetLabel(target))).join("<br />")}</p><small>${e.syncState?.providerWriteStatus === "pending" ? "Update requested; connected-calendar delivery is not yet confirmed." : ["failed", "partial_failure"].includes(e.syncState?.providerWriteStatus) ? "A connected-calendar update needs attention." : "Connected-calendar updates are processed separately."}</small></section>` : ""}${e.labels.length ? `<section class="detail-section"><h3>Labels</h3><div class="detail-badges">${e.labels.map((x) => badge(x)).join("")}</div></section>` : ""}${e.status === "pending_approval" ? '<div class="note-box"><strong>Time awaiting confirmation</strong><p>Check with the organizer before treating this as a confirmed plan.</p></div>' : ""}${e.privacy === "busy_only" ? '<p class="privacy-note">Busy only controls how this item is displayed when shared. Authorized organization calendar viewers can still see its details.</p>' : ""}${e.type === "volunteer_shift" && current()?.fieldAccess ? `<section class="detail-section"><h3>Ready for the field</h3><p>Find your territory and team assignments in Field work. Field event participation and rides are managed separately.</p>${btn("Open Field work " + icon("arrow"), "destination", 'data-destination="Field work"')}</section>` : ""}</div><footer class="dialog-footer">${btn("Done", "close")}</footer>`,
    );
  }
  function showConnection(id) {
    const c = state.connections.find((c) => c.id === id);
    if (!c) return;
    openDialog(
      "#detail-dialog",
      `${header(c.providerLabel, "detail-title", c.account)}<div class="dialog-body">${badge(connectionStatus(c), connectionReady(c) ? "success" : "warning")}<dl class="detail-meta"><div class="full-width"><dt>Last successful sync</dt><dd>${c.lastSyncAt ? esc(formatInstant(c.lastSyncAt)) : "Not synced yet"}</dd></div><div><dt>Import schedule items</dt><dd>${c.calendars.some((x) => x.imported) ? "Enabled" : "Disabled"}</dd></div><div><dt>New calendar items</dt><dd>${calendarWriteTargets([c]).length ? "Available as a destination" : "Not available as a destination"}</dd></div></dl><section class="detail-section"><h3>Calendars</h3>${c.calendars.map((entry) => `<p><strong>${esc(entry.title)}</strong><br />${entry.imported ? "Imports items" : "Import disabled"} · ${entry.writable ? "Write enabled" : "Import only"}</p>`).join("") || "<p>No calendars are available.</p>"}</section>${c.error ? `<div class="note-box">${esc(c.error)}</div>` : ""}<div class="note-box">${connectionReady(c) ? "Calendar items can be viewed by people with access to the destination calendar." : "Previously imported items may be out of date until the connection is restored."}</div></div><footer class="dialog-footer">${btn("Done", "close")}</footer>`,
    );
  }

  function showCreate(day = state.selected) {
    if (
      !canManage() ||
      ["loading", "denied", "error"].includes(state.condition)
    )
      return;
    state.saveUncertain = false;
    openDialog(
      "#create-dialog",
      `<form id="item-form" class="calendar-item-form" data-cal-form="create">${header("New calendar item", "create-title", "Give your team a clear time, place, and purpose.")}<div class="dialog-body form-grid"><label class="field full-width"><span>Title <span aria-hidden="true">*</span></span><input name="title" required maxlength="160" placeholder="e.g. Neighborhood listening evening" /></label><label class="field"><span>Type</span><select name="type">${Object.entries(
        types,
      )
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join(
          "",
        )}</select></label><label class="field"><span>Status</span><select name="status">${Object.entries(
        statuses,
      )
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join(
          "",
        )}</select></label><label class="check-item full-width"><input name="allDay" type="checkbox" /><span>All-day item</span></label><label class="field"><span>Starts <span aria-hidden="true">*</span></span><input name="start" type="datetime-local" value="${day}T09:00" required /></label><label class="field"><span>Ends <span aria-hidden="true">*</span></span><input name="end" type="datetime-local" value="${day}T10:00" required /></label><p class="form-help full-width">Times use ${esc(zoneLabel())} (${esc(state.zone)}).</p><label class="field full-width"><span>Location</span><input name="location" maxlength="200" placeholder="Venue, meeting link, or address" /></label><label class="field full-width"><span>Description</span><textarea name="description" maxlength="4000" placeholder="What should people know before they arrive?"></textarea></label><label class="field full-width"><span>Labels</span><input name="labels" maxlength="250" placeholder="Community, Team, North Cedar" /><small>Separate labels with commas.</small></label><details class="advanced-settings full-width"><summary>Sharing & connected calendars</summary><div class="advanced-content"><label class="field"><span>Calendar display</span><select name="privacy"><option value="details">Show details</option><option value="busy_only">Busy only</option></select><small>Busy only changes the shared display. It does not hide details from authorized organization calendar viewers.</small></label><fieldset class="destination-options"><legend>Also add to</legend>${
        state.connectionsError
          ? `<p>Connected-calendar destinations are unavailable. You can still add this item in Polis.</p>`
          : !writeTargets().length
            ? `<p>No connected calendars are available for new items.</p>`
            : writeTargets()
                .map(
                  (target) =>
                    `<label class="check-item"><input name="writeTarget" type="checkbox" value="${esc(target.value)}" /><span>${esc(target.label)}</span></label>`,
                )
                .join("")
      }<p>Optional. People with access to the destination calendar may see this item.</p></fieldset></div></details><p id="form-error" class="form-error full-width" role="alert" hidden></p></div><footer class="dialog-footer"><small>Calendar destinations update after saving.</small>${btn("Cancel", "close")}<button type="submit" class="primary-button">Add calendar item</button></footer></form>`,
    );
  }

  function handoff(destination) {
    if (!current()) return;
    const base = `/coalitions/${encodeURIComponent(current().coalitionId)}`;
    const routes = {
      "Field events": `${base}/calendar/field-events`,
      Transportation: `${base}/calendar/field-events/transport`,
      "Field work": `${base}/voter-map`,
    };
    if (!routes[destination] || !current().fieldAccess) return;
    closeDialog();
    navigate(routes[destination]);
  }

  function move(delta) {
    state.from = "";
    state.to = "";
    if (state.view === "week") state.anchor = addDays(state.anchor, 7 * delta);
    else {
      const d = date(state.anchor);
      state.anchor = key(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)),
      );
    }
    state.selected = state.anchor;
    render();
    void load({ refresh: true });
  }

  /* lifecycle and real transport below */
  function sync() {
    const next = current(),
      nextKey = identity(next);
    if (nextKey !== state.key) {
      reset();
      state.key = nextKey;
      state.zone = calendarZone(next?.timeZone);
      today = calendarLocal(Date.now(), state.zone).slice(0, 10);
      state.selected = today;
      state.anchor = today;
    }
    if (!canManage()) {
      const create = q('[data-cal-dialog="create"]');
      if (create?.open) create.close();
    }
    if (!canView()) {
      state.condition = "denied";
      state.items = [];
      state.connections = [];
      state.loaded = false;
    }
    return nextKey;
  }
  function reset() {
    generation++;
    loadSequence++;
    flight = null;
    observer?.disconnect();
    observer = null;
    clearTimeout(toastTimer);
    host?.remove();
    host = null;
    state = fresh();
    focusSnapshot = null;
  }
  function guard(ticket, mutation = false) {
    if (
      ticket !== generation ||
      !state.key ||
      identity() !== state.key ||
      !canView() ||
      (mutation && !canManage())
    ) {
      if (ticket === generation) {
        reset();
        onContextInvalidated();
      }
      throw Object.assign(
        new Error(
          "Account, calendar access, or workspace changed. Reopen Calendar.",
        ),
        { stale: true },
      );
    }
  }
  async function call(url, options = {}) {
    const ticket = generation,
      mutation = options.method && options.method !== "GET";
    guard(ticket, mutation);
    const headers = Object.fromEntries(
      (typeof Headers !== "undefined" && options.headers instanceof Headers
        ? [...options.headers.entries()]
        : Object.entries(options.headers || {})
      ).map(([name, value]) => [name.toLowerCase(), value]),
    );
    headers["x-polis-expected-actor"] = current().userId;
    const result = await request(url, {
      ...options,
      auth: true,
      headers,
      beforeRequest: (...args) => {
        guard(ticket, mutation);
        options.beforeRequest?.(...args);
        guard(ticket, mutation);
      },
      beforeDispatch: (...args) => {
        guard(ticket, mutation);
        options.beforeDispatch?.(...args);
        guard(ticket, mutation);
      },
    });
    guard(ticket, mutation);
    if (result?.ok === false)
      throw Object.assign(
        new Error(
          text(result.message || result.error) || "Calendar request failed.",
        ),
        { payload: result },
      );
    return result;
  }
  function queryRange() {
    let [from, to] = range();
    if (state.view === "month") {
      from = addDays(from, -((date(from).getUTCDay() + 6) % 7));
      to = addDays(to, 6 - ((date(to).getUTCDay() + 6) % 7));
    }
    // Include the floating UTC dates used by all-day provider events as well as
    // every local-clock interval, including zones with unusual midnight offsets.
    return {
      from: Date.parse(`${from}T00:00:00Z`) - 86400000,
      to: Date.parse(`${addDays(to, 1)}T00:00:00Z`) + 86400000,
    };
  }
  async function readItems(sequence) {
    const bounds = queryRange(),
      items = new Map(),
      seen = new Set();
    let cursor = "",
      pages = 0,
      evaluated = 0,
      limited = "";
    do {
      if (sequence !== loadSequence)
        throw Object.assign(new Error("Calendar range changed."), {
          stale: true,
        });
      const query = new URLSearchParams({
        from: String(bounds.from),
        to: String(bounds.to),
        overlap: "true",
      });
      if (cursor) query.set("cursor", cursor);
      const payload = await call(`${endpoint("/items")}?${query}`);
      if (sequence !== loadSequence)
        throw Object.assign(new Error("Calendar range changed."), {
          stale: true,
        });
      for (const raw of rows(payload, ["items", "calendar"])) {
        const item = calendarItem(raw, state.zone);
        if (item) items.set(item.id, item);
      }
      pages++;
      evaluated += Math.max(0, Number(payload.pageBudget?.evaluatedCount) || 0);
      const next = text(payload.nextCursor);
      if (payload.overlap !== true)
        throw new Error(
          "Your calendar service is updating. Refresh again shortly.",
        );
      if (!next) {
        if (payload.complete === false)
          limited =
            "The calendar response is incomplete. Refresh to try again.";
        break;
      }
      if (
        seen.has(next) ||
        pages >= 40 ||
        evaluated >= 10000 ||
        items.size >= 10000
      ) {
        limited =
          "This calendar request reached the loading limit. Some items may be missing; choose a smaller range in Agenda.";
        break;
      }
      seen.add(next);
      cursor = next;
    } while (cursor);
    return {
      items: [...items.values()].sort((a, b) => a.startAt - b.startAt),
      limited,
    };
  }
  async function readConnections() {
    const payload = await call(endpoint("/connections"));
    return rows(payload, ["connections"]).map(calendarConnection);
  }
  async function load({ refresh = false } = {}) {
    if (!sync() || !canView()) {
      render();
      return;
    }
    if (!refresh && state.loaded) return;
    if (!refresh && flight) return flight;
    const ticket = generation,
      sequence = ++loadSequence;
    state.condition = "loading";
    state.error = "";
    state.limited = "";
    render();
    const task = (async () => {
      const [itemsResult, connectionsResult] = await Promise.allSettled([
        readItems(sequence),
        readConnections(),
      ]);
      try {
        guard(ticket);
      } catch {
        return;
      }
      if (sequence !== loadSequence) return;
      if (itemsResult.status === "fulfilled") {
        state.items = itemsResult.value.items;
        state.limited = itemsResult.value.limited;
        state.loaded = true;
        onItems(state.items, current().coalitionId);
        state.condition =
          state.items.length || state.limited ? "ready" : "empty";
      } else {
        state.items = [];
        state.loaded = false;
        state.error =
          itemsResult.reason?.message || "Your schedule could not be loaded.";
        state.condition = [401, 403].includes(
          Number(itemsResult.reason?.status),
        )
          ? "denied"
          : "error";
      }
      if (connectionsResult.status === "fulfilled") {
        state.connections = connectionsResult.value;
        state.connectionsError = "";
      } else {
        state.connections = [];
        state.connectionsError = [401, 403].includes(
          Number(connectionsResult.reason?.status),
        )
          ? "Your role does not include connected-calendar access."
          : "Connected calendars could not be loaded. Try again in a moment.";
      }
      render();
    })();
    flight = task;
    await task;
    if (flight === task) flight = null;
  }
  function markup() {
    sync();
    return "<div data-coalition-calendar-host></div>";
  }
  function beforeRender() {
    const active = document.activeElement;
    if (!host?.contains(active)) return;
    focusSnapshot = {
      element: active,
      start: active.selectionStart,
      end: active.selectionEnd,
    };
  }
  function mount(root) {
    const placeholder = root.querySelector("[data-coalition-calendar-host]");
    if (!placeholder || !sync()) {
      if (host && !placeholder) reset();
      return;
    }
    if (!host) {
      host = document.createElement("section");
      host.className = "coalition-calendar-page";
      host.setAttribute("aria-label", "Calendar workspace");
      host.addEventListener("click", onClick);
      host.addEventListener("input", onInput);
      host.addEventListener("change", onChange);
      host.addEventListener("submit", onSubmit);
      host.addEventListener("keydown", onKeydown);
      host.addEventListener(
        "cancel",
        (event) => {
          event.stopPropagation();
          if (state.pending) event.preventDefault();
        },
        true,
      );
      host.addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".calendar-filters")) {
          host.classList.remove("calendar-filters-open");
          q('[data-cal-action="toggle-filters"]')?.setAttribute(
            "aria-expanded",
            "false",
          );
        }
      });
      render();
    }
    placeholder.replaceWith(host);
    for (const dialog of host.querySelectorAll("dialog[open]"))
      if (!dialog.matches(":modal")) {
        dialog.close();
        dialog.showModal();
      }
    if (focusSnapshot?.element?.isConnected) {
      focusSnapshot.element.focus({ preventScroll: true });
      if (
        typeof focusSnapshot.start === "number" &&
        typeof focusSnapshot.element.setSelectionRange === "function"
      )
        focusSnapshot.element.setSelectionRange(
          focusSnapshot.start,
          focusSnapshot.end,
        );
    }
    focusSnapshot = null;
    if (!observer) {
      observer = new ResizeObserver(() => requestAnimationFrame(fitMonth));
      observer.observe(host);
    }
    fitMonth();
    if (!state.loaded && !flight && state.condition !== "denied") void load();
  }
  function closeDialog() {
    if (state.pending) return;
    for (const dialog of host?.querySelectorAll("dialog[open]") || [])
      dialog.close();
    if (state.opener?.isConnected) state.opener.focus({ preventScroll: true });
  }
  function showFormError(message, uncertain = false) {
    const el = q("#form-error");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    if (uncertain) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "text-button";
      action.dataset.calAction = "check-save";
      action.textContent = "Check calendar";
      el.append(document.createElement("br"), action);
    }
    el.scrollIntoView({ block: "nearest" });
  }
  function setPending(pending) {
    state.pending = pending;
    for (const control of q("#item-form")?.querySelectorAll(
      "input,select,textarea,button",
    ) || [])
      control.disabled = pending;
    const submit = q('#item-form [type="submit"]');
    if (submit) submit.textContent = pending ? "Adding…" : "Add calendar item";
  }
  async function save(form) {
    if (state.pending || state.saveUncertain || !canManage()) return;
    const ticket = generation,
      data = new FormData(form);
    let body;
    let dispatched = false;
    try {
      body = calendarCreateBody(data, state.zone, writeTargets());
    } catch (error) {
      showFormError(error.message);
      return;
    }
    setPending(true);
    try {
      if (body.externalWriteTargets.length) {
        state.connections = await readConnections();
        state.connectionsError = "";
        body = calendarCreateBody(data, state.zone, writeTargets());
      }
      guard(ticket, true);
      dispatched = true;
      const payload = await call(endpoint("/items"), { method: "POST", body });
      const item = calendarItem(payload.item || payload, state.zone);
      if (!item)
        throw Object.assign(
          new Error("The saved item could not be confirmed."),
          { status: 502 },
        );
      state.items = [
        item,
        ...state.items.filter((entry) => entry.id !== item.id),
      ].sort((a, b) => a.startAt - b.startAt);
      state.loaded = true;
      onItems(state.items, current().coalitionId);
      state.condition = "ready";
      state.selected = item.start.slice(0, 10);
      state.anchor = state.selected;
      state.query = "";
      state.type = "all";
      state.status = "all";
      state.from = "";
      state.to = "";
      setPending(false);
      closeDialog();
      render();
      showItem(item.id);
      toast("Calendar item created.");
    } catch (error) {
      if (error.stale) return;
      setPending(false);
      const ambiguous =
        dispatched &&
        (!Number.isFinite(Number(error.status)) || Number(error.status) >= 500);
      state.saveUncertain = ambiguous;
      state.pendingBody = body;
      showFormError(
        ambiguous
          ? "The save result could not be confirmed. Check the calendar before trying again."
          : error.message || "Calendar item could not be created.",
        ambiguous,
      );
      if (ambiguous) {
        const submit = q('#item-form [type="submit"]');
        if (submit) submit.disabled = true;
      }
    }
  }
  async function checkSave() {
    const body = state.pendingBody;
    if (!body) return;
    await load({ refresh: true });
    const found = state.items.find(
      (item) =>
        item.title === body.title &&
        item.startAt === body.startAt &&
        item.endAt === body.endAt,
    );
    if (found) {
      state.saveUncertain = false;
      closeDialog();
      showItem(found.id);
      toast("The calendar item was saved.");
    } else
      showFormError(
        "The save could not be confirmed yet. Your draft is preserved. Check again before adding another item.",
        true,
      );
  }
  function eventCurrent() {
    if (!state.key || identity() !== state.key || !canView()) {
      reset();
      onContextInvalidated();
      return false;
    }
    return true;
  }
  function onClick(event) {
    const el = event.target.closest("[data-cal-action]");
    if (!el || !host?.contains(el)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!eventCurrent()) return;
    const action = el.dataset.calAction;
    if (action === "close") {
      closeDialog();
      return;
    }
    if (action === "item") {
      showItem(el.dataset.id);
      return;
    }
    if (action === "new-item") {
      showCreate(el.dataset.day || state.selected);
      return;
    }
    if (action === "connection") {
      showConnection(el.dataset.id);
      return;
    }
    if (action === "destination") {
      handoff(el.dataset.destination);
      return;
    }
    if (action === "toggle-filters") {
      const expanded = host.classList.toggle("calendar-filters-open");
      el.setAttribute("aria-expanded", String(expanded));
      requestAnimationFrame(fitMonth);
      return;
    }
    if (action === "tab") {
      state.tab = el.dataset.tab;
      render();
      q(`#cal-tab-${state.tab}`).focus();
      return;
    }
    if (action === "view") {
      state.view = el.dataset.view;
      state.anchor = state.selected;
      state.from = "";
      state.to = "";
      render();
      q(`[data-cal-action="view"][data-view="${state.view}"]`).focus();
      void load({ refresh: true });
      return;
    }
    if (action === "previous" || action === "next") {
      move(action === "next" ? 1 : -1);
      q(`[data-cal-action="${action}"]`).focus();
      return;
    }
    if (action === "today") {
      today = calendarLocal(Date.now(), state.zone).slice(0, 10);
      state.from = "";
      state.to = "";
      state.anchor = today;
      state.selected = today;
      render();
      void load({ refresh: true });
      return;
    }
    if (action === "select-day") {
      state.selected = el.dataset.day;
      renderResults();
      if (matchMedia("(max-width:760px)").matches) showDay();
      else
        q(`.day-number[data-day="${state.selected}"]`)?.focus({
          preventScroll: true,
        });
      return;
    }
    if (action === "clear-filters") {
      state.query = "";
      state.type = "all";
      state.status = "all";
      render();
      return;
    }
    if (action === "whole-month") {
      const d = date(state.anchor);
      state.from = key(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
      );
      state.to = key(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)),
      );
      render();
      void load({ refresh: true });
      return;
    }
    if (action === "refresh" || action === "retry") {
      void load({ refresh: true });
      return;
    }
    if (action === "check-save") void checkSave();
  }
  function onInput(event) {
    if (!host?.contains(event.target) || !eventCurrent()) return;
    const node = event.target;
    if (node.matches("[data-cal-search]")) {
      state.query = node.value;
      renderResults();
    }
    if (
      node.form?.matches('[data-cal-form="create"]') &&
      !state.saveUncertain
    ) {
      const error = q("#form-error");
      if (error) error.hidden = true;
    }
  }
  function onChange(event) {
    if (!host?.contains(event.target) || !eventCurrent()) return;
    const node = event.target;
    if (node.matches("[data-cal-type]")) {
      state.type = node.value;
      renderResults();
    }
    if (node.matches("[data-cal-status]")) {
      state.status = node.value;
      renderResults();
    }
    if (node.matches("[data-cal-from],[data-cal-to]")) {
      if (!node.value) return;
      state.from = q("[data-cal-from]").value;
      state.to = q("[data-cal-to]").value;
      renderResults();
      if (state.from && state.to && state.to >= state.from)
        void load({ refresh: true });
    }
    if (node.name === "allDay") {
      for (const name of ["start", "end"]) {
        const field = node.form.elements[name],
          day = field.value.slice(0, 10) || state.selected;
        field.type = node.checked ? "date" : "datetime-local";
        field.value = node.checked
          ? day
          : `${day}T${name === "start" ? "09:00" : "10:00"}`;
      }
    }
  }
  function onSubmit(event) {
    const form = event.target.closest('[data-cal-form="create"]');
    if (!form || !host?.contains(form)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!eventCurrent()) return;
    void save(form);
  }
  function onKeydown(event) {
    if (!host?.contains(event.target) || !eventCurrent()) return;
    if (
      event.target.matches('[role="tab"]') &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      state.tab =
        event.key === "Home"
          ? "schedule"
          : event.key === "End"
            ? "connections"
            : state.tab === "schedule"
              ? "connections"
              : "schedule";
      render();
      q(`#cal-tab-${state.tab}`).focus();
    }
    if (
      event.target.matches(".day-number") &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      state.selected = addDays(
        event.target.dataset.day,
        { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key],
      );
      if (state.selected.slice(0, 7) !== state.anchor.slice(0, 7)) {
        state.anchor = state.selected;
        render();
        void load({ refresh: true });
      } else renderResults();
      q(`.day-number[data-day="${state.selected}"]`)?.focus();
    }
  }
  return { markup, mount, load, reset, beforeRender };
}
