import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL(
    "../frontend/src/pages/shared-feed/scripts/coalitionCalendarModel.js",
    import.meta.url,
  ),
  "utf8",
);
const model = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const zone = "America/Denver";
const timed = (start, end, extra = {}) =>
  model.calendarItem(
    {
      calendarItemId: "item",
      title: "Meeting",
      itemType: "appointment",
      startAtIso: start,
      endAtIso: end,
      ...extra,
    },
    zone,
  );
const form = (values = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    title: "Team meeting",
    type: "appointment",
    status: "confirmed",
    start: "2026-10-26T09:00",
    end: "2026-10-26T10:00",
    ...values,
  })) {
    for (const entry of Array.isArray(value) ? value : [value])
      data.append(name, entry);
  }
  return data;
};

test("backend numeric timestamps remain milliseconds, including epoch and negative values", () => {
  assert.equal(model.calendarTimestamp(0), 0);
  assert.equal(model.calendarTimestamp("1234"), 1234);
  assert.equal(model.calendarTimestamp(-1000), -1000);
  assert.equal(
    model.calendarTimestamp("2026-10-26T15:00:00Z"),
    Date.parse("2026-10-26T15:00:00Z"),
  );
  assert.equal(model.calendarTimestamp("invalid"), null);
});
test("calendar creation uses the explicit display zone rather than the process zone", () => {
  const body = model.calendarCreateBody(form(), zone, []);
  assert.equal(body.startAt, Date.parse("2026-10-26T15:00:00Z"));
  assert.equal(body.endAt, Date.parse("2026-10-26T16:00:00Z"));
  assert.equal(body.timeZone, zone);
  assert.equal(
    model.calendarLocal(body.startAt, "Asia/Tokyo"),
    "2026-10-27T00:00",
  );
});
test("summer and winter offsets are resolved independently", () => {
  assert.equal(
    model.calendarInstant("2026-07-01T09:00", zone),
    Date.parse("2026-07-01T15:00Z"),
  );
  assert.equal(
    model.calendarInstant("2026-12-01T09:00", zone),
    Date.parse("2026-12-01T16:00Z"),
  );
});
test("DST gaps and repeated hours are rejected instead of silently moved", () => {
  assert.throws(
    () => model.calendarInstant("2026-03-08T02:30", zone),
    /does not exist/u,
  );
  assert.throws(
    () => model.calendarInstant("2026-11-01T01:30", zone),
    /occurs twice/u,
  );
  assert.throws(
    () => model.calendarInstant("2026-02-30T09:00", zone),
    /valid date/u,
  );
});
test("all-day form dates stay floating UTC dates with an exclusive final midnight", () => {
  const body = model.calendarCreateBody(
    form({ allDay: "on", start: "2026-10-28", end: "2026-10-29" }),
    zone,
    [],
  );
  assert.equal(body.startAt, Date.parse("2026-10-28T00:00Z"));
  assert.equal(body.endAt, Date.parse("2026-10-30T00:00Z"));
  const item = model.calendarItem(
    { ...body, calendarItemId: "all-day" },
    "America/Los_Angeles",
  );
  assert.equal(item.start.slice(0, 10), "2026-10-28");
  assert.equal(model.calendarLastDay(item), "2026-10-29");
  assert.equal(model.calendarOnDay(item, "2026-10-30"), false);
  assert.match(model.calendarDuration(item), /Oct 28–Oct 29/u);
});
test("timed midnight endings belong to the previous day", () => {
  const item = timed("2026-10-27T04:00Z", "2026-10-27T06:00Z");
  assert.equal(model.calendarOnDay(item, "2026-10-26"), true);
  assert.equal(model.calendarOnDay(item, "2026-10-27"), false);
});
test("a multi-day item that started before the visible range still overlaps", () => {
  const item = timed("2026-09-30T15:00Z", "2026-10-03T17:00Z");
  assert.equal(model.calendarInRange(item, "2026-10-01", "2026-10-31"), true);
  assert.equal(model.calendarOnDay(item, "2026-10-02"), true);
  assert.equal(model.calendarInRange(item, "2026-10-04", "2026-10-31"), false);
  assert.match(model.calendarDuration(item), /Sep 30.*Oct 3/u);
});
test("zero-duration reminders remain recognizable points on their day", () => {
  const item = timed("2026-10-26T15:00Z", null, { itemType: "reminder" });
  assert.equal(model.calendarOnDay(item, "2026-10-26"), true);
});
test("calendar rights require active membership and explicit permissions", () => {
  assert.deepEqual(
    model.calendarPermissions({
      isActive: true,
      permissions: ["calendar_view"],
    }),
    { view: true, manage: false },
  );
  assert.deepEqual(
    model.calendarPermissions({
      isActive: true,
      permissions: ["calendar_manage"],
    }),
    { view: true, manage: true },
  );
  assert.deepEqual(
    model.calendarPermissions({
      isActive: true,
      permissions: ["calendar_promotion_manage"],
    }),
    { view: true, manage: true },
  );
  assert.deepEqual(
    model.calendarPermissions({ isAdmin: true, isActive: false }),
    { view: false, manage: false },
  );
  assert.deepEqual(
    model.calendarPermissions({
      isAdmin: true,
      isActive: true,
      isPending: true,
    }),
    { view: false, manage: false },
  );
  assert.deepEqual(model.calendarPermissions(null), {
    view: false,
    manage: false,
  });
});
test("external destinations require writable calendars on a ready connection", () => {
  const good = model.calendarConnection({
    connectionId: "g",
    provider: "google",
    status: "connected",
    calendars: [
      { calendarId: "cal:one", title: "Team", writeEnabled: true },
      { calendarId: "read", title: "Read only", writeEnabled: false },
    ],
  });
  const bad = model.calendarConnection({
    connectionId: "m",
    provider: "microsoft",
    status: "needs_reauth",
    calendars: [{ calendarId: "old", writeEnabled: true }],
  });
  const targets = model.calendarWriteTargets([good, bad]);
  assert.equal(targets.length, 1);
  const body = model.calendarCreateBody(
    form({ writeTarget: "google:cal:one" }),
    zone,
    targets,
  );
  assert.deepEqual(body.externalWriteTargets, [
    { provider: "google", calendarId: "cal:one", mode: "write" },
  ]);
  assert.throws(
    () =>
      model.calendarCreateBody(
        form({ writeTarget: "google:forged" }),
        zone,
        targets,
      ),
    /no longer available/u,
  );
  assert.throws(
    () =>
      model.calendarCreateBody(
        form({ writeTarget: "google:cal:one" }),
        zone,
        [],
      ),
    /no longer available/u,
  );
});
test("creation accepts only supported types, statuses and valid intervals", () => {
  assert.throws(
    () => model.calendarCreateBody(form({ title: " " }), zone, []),
    /title/u,
  );
  assert.throws(
    () => model.calendarCreateBody(form({ type: "fake" }), zone, []),
    /type and status/u,
  );
  assert.throws(
    () => model.calendarCreateBody(form({ status: "rejected" }), zone, []),
    /type and status/u,
  );
  assert.throws(
    () => model.calendarCreateBody(form({ end: "2026-10-26T08:00" }), zone, []),
    /after/u,
  );
  assert.throws(
    () =>
      model.calendarCreateBody(
        form({
          labels: Array.from({ length: 13 }, (_, i) => `label${i}`).join(","),
        }),
        zone,
        [],
      ),
    /12 labels/u,
  );
});
test("busy-only sharing is retained while invalid privacy never promises hidden data", () => {
  assert.equal(
    model.calendarCreateBody(form({ privacy: "busy_only" }), zone, []).privacy,
    "busy_only",
  );
  assert.equal(
    model.calendarCreateBody(form({ privacy: "private" }), zone, []).privacy,
    "details",
  );
  assert.equal(
    model.calendarEscape('<img src=x onerror="bad">'),
    "&lt;img src=x onerror=&quot;bad&quot;&gt;",
  );
});
