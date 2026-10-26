export const calendarTypes = Object.freeze({
  campaign_event: "Campaign event",
  volunteer_shift: "Volunteer shift",
  meeting_request: "Meeting request",
  appointment: "Appointment",
  office_hours: "Office hours",
  scheduled_promotion: "Promotion",
  public_booking: "Public booking",
  travel: "Travel",
  reminder: "Reminder",
  busy: "Busy block",
  coalition_shared: "Shared item",
});
export const calendarStatuses = Object.freeze({
  confirmed: "Confirmed",
  pending_approval: "Pending approval",
  approved: "Approved",
  denied: "Denied",
  canceled: "Cancelled",
  needs_review: "Needs review",
});
export const calendarText = (value) => String(value ?? "").trim();
export const calendarEscape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const calendarRows = (payload, names = []) =>
  Array.isArray(payload)
    ? payload
    : names.map((name) => payload?.[name]).find(Array.isArray) || [];
export const calendarTimestamp = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.round(numeric);
  const parsed = Date.parse(calendarText(value));
  return Number.isFinite(parsed) ? parsed : null;
};
export function calendarZone(value) {
  const zone =
    calendarText(value) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return zone;
  } catch {
    return "UTC";
  }
}
export function calendarLocal(timestamp, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: calendarZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const calendarDay = (value) =>
  new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
export const calendarDayKey = (value) => value.toISOString().slice(0, 10);
export function calendarAddDays(value, days) {
  const d = calendarDay(value);
  d.setUTCDate(d.getUTCDate() + days);
  return calendarDayKey(d);
}
export function calendarDateLabel(value, options = {}) {
  return calendarDay(value).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...options,
  });
}
export function calendarFullDate(value) {
  return calendarDateLabel(value, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
export const calendarTime = (value) => {
  const [h, m] = value.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** Convert an explicit wall-clock value without assuming the browser's zone.
 * DST gaps and repeated clock times require an unambiguous choice, rather than
 * silently moving the meeting or choosing a different offset. */
export function calendarInstant(local, zone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(local))
    throw new Error("Choose a valid start and end time.");
  const guess = Date.parse(`${local}:00Z`);
  if (
    !Number.isFinite(guess) ||
    new Date(guess).toISOString().slice(0, 16) !== local
  )
    throw new Error("Choose a valid date and time.");
  const offsets = new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const instant = guess + hours * 3600000;
    offsets.add(Date.parse(`${calendarLocal(instant, zone)}:00Z`) - instant);
  }
  const matches = [...offsets]
    .map((offset) => guess - offset)
    .filter((instant) => calendarLocal(instant, zone) === local);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "This time occurs twice when the clocks change. Choose a time outside the repeated hour."
        : "This time does not exist when the clocks change. Choose another time.",
    );
  return matches[0];
}
export function calendarItem(raw, zone) {
  const startAt = calendarTimestamp(
    raw.startAt ?? raw.startAtIso ?? raw.startsAt,
  );
  const endAt =
    calendarTimestamp(raw.endAt ?? raw.endAtIso ?? raw.endsAt) ?? startAt;
  const id = calendarText(raw.calendarItemId || raw.id || raw.itemId);
  if (!id || startAt == null || endAt == null || endAt < startAt) return null;
  return {
    id,
    title: calendarText(raw.title) || "Calendar item",
    type: calendarText(raw.itemType || raw.type) || "busy",
    status: calendarText(raw.status) || "confirmed",
    startAt,
    endAt,
    start: calendarLocal(startAt, raw.allDay === true ? "UTC" : zone),
    end: calendarLocal(endAt, raw.allDay === true ? "UTC" : zone),
    allDay: raw.allDay === true,
    privacy: raw.privacy === "busy_only" ? "busy_only" : "details",
    description: calendarText(raw.description),
    location: calendarText(raw.locationName || raw.location),
    address: calendarText(raw.locationAddress),
    labels: calendarRows(raw.labels).map(calendarText).filter(Boolean),
    provider: calendarText(raw.provider),
    source: calendarText(raw.source) || "polis",
    externalWriteTargets: calendarRows(raw.externalWriteTargets),
    syncState: raw.syncState || null,
    raw,
  };
}
export const calendarLastDay = (item) =>
  item.end.slice(11, 16) === "00:00" && item.endAt > item.startAt
    ? calendarAddDays(item.end, -1)
    : item.end.slice(0, 10);
export const calendarOnDay = (item, day) =>
  item.start.slice(0, 10) <= day && calendarLastDay(item) >= day;
export const calendarInRange = (item, from, to) =>
  item.start.slice(0, 10) <= to && calendarLastDay(item) >= from;
export function calendarDuration(item) {
  const cross = item.start.slice(0, 10) !== calendarLastDay(item);
  const short = (value) =>
    calendarDateLabel(value, { month: "short", day: "numeric" });
  return item.allDay
    ? `All day${cross ? ` · ${short(item.start)}–${short(calendarLastDay(item))}` : ""}`
    : cross
      ? `${short(item.start)}, ${calendarTime(item.start)} – ${short(item.end)}, ${calendarTime(item.end)}`
      : `${calendarTime(item.start)} – ${calendarTime(item.end)}`;
}
export function calendarConnection(raw = {}) {
  const provider = calendarText(raw.provider).toLowerCase();
  const labels = {
    google: "Google Calendar",
    microsoft: "Microsoft Outlook",
    apple: "Apple Calendar",
  };
  const normalize = (entry) => ({
    id: calendarText(entry.calendarId || entry.id),
    title:
      calendarText(entry.title || entry.summary || entry.name) || "Calendar",
    imported: entry.importEnabled !== false,
    writable: entry.writeEnabled === true || entry.defaultWrite === true,
  });
  const calendars = calendarRows(raw, ["calendars"]).map(normalize);
  const fallback = [
    ...calendarRows(raw, ["writeCalendars"]).map((r) => ({
      ...normalize(r),
      writable: true,
    })),
    ...calendarRows(raw, ["importedCalendars"]).map(normalize),
  ];
  return {
    id: calendarText(raw.connectionId || raw.id) || provider,
    provider,
    providerLabel:
      calendarText(raw.providerLabel) ||
      labels[provider] ||
      "Connected calendar",
    account:
      calendarText(raw.accountLabel || raw.account) || "Connected calendar",
    status: calendarText(raw.status) || "connected",
    lastSyncAt: calendarTimestamp(raw.lastSyncAt),
    error: calendarText(raw.syncError),
    calendars: calendars.length ? calendars : fallback,
  };
}
export function calendarWriteTargets(connections) {
  return connections
    .filter((c) => ["connected", "active"].includes(c.status) && !c.error)
    .flatMap((c) =>
      c.calendars
        .filter((entry) => entry.id && entry.writable)
        .map((entry) => ({
          value: `${c.provider}:${entry.id}`,
          provider: c.provider,
          calendarId: entry.id,
          label: `${c.providerLabel} · ${entry.title}`,
        })),
    );
}
export function calendarPermissions(membership) {
  const active =
    membership?.isActive === true && membership?.isPending !== true;
  const permissions = new Set(membership?.permissions || []);
  const manage =
    active &&
    (membership.isAdmin === true ||
      permissions.has("calendar_manage") ||
      permissions.has("calendar_promotion_manage"));
  return {
    view: active && (manage || permissions.has("calendar_view")),
    manage,
  };
}
export function calendarCreateBody(form, zone, targets) {
  const title = calendarText(form.get("title"));
  const type = calendarText(form.get("type"));
  const status = calendarText(form.get("status"));
  if (!title) throw new Error("Add a title for this calendar item.");
  if (!calendarTypes[type] || !calendarStatuses[status])
    throw new Error("Choose a valid calendar type and status.");
  const allDay = form.has("allDay");
  const start = calendarText(form.get("start"));
  const end = calendarText(form.get("end"));
  const startAt = calendarInstant(
    allDay ? `${start}T00:00` : start,
    allDay ? "UTC" : zone,
  );
  const endAt = calendarInstant(
    allDay ? `${calendarAddDays(end, 1)}T00:00` : end,
    allDay ? "UTC" : zone,
  );
  if (endAt <= startAt)
    throw new Error("End time must be after the start time.");
  const values = form.getAll("writeTarget").map(calendarText);
  if (values.some((value) => !targets.some((target) => target.value === value)))
    throw new Error(
      "A selected calendar is no longer available. Review the destinations and try again.",
    );
  const labels = calendarText(form.get("labels"))
    .split(",")
    .map(calendarText)
    .filter(Boolean);
  if (labels.length > 12) throw new Error("Use no more than 12 labels.");
  return {
    itemType: type,
    title: title.slice(0, 200),
    description:
      calendarText(form.get("description")).slice(0, 4000) || undefined,
    locationName: calendarText(form.get("location")).slice(0, 200) || undefined,
    startAt,
    endAt,
    timeZone: zone,
    allDay,
    privacy: form.get("privacy") === "busy_only" ? "busy_only" : "details",
    status,
    labels,
    externalWriteTargets: [...new Set(values)].map((value) => {
      const target = targets.find((entry) => entry.value === value);
      return {
        provider: target.provider,
        calendarId: target.calendarId,
        mode: "write",
      };
    }),
  };
}
