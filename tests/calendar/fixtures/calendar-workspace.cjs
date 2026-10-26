const samples = require("./calendar-samples.json");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9067";
const COALITION_ID = "cedar-valley";
const COALITION_PATH = `/coalitions/${COALITION_ID}`;
const FIXED_TIME = Date.parse("2026-10-26T18:00:00Z");
const clone = (value) => JSON.parse(JSON.stringify(value));
const stamp = (value) =>
  Date.parse(
    `${value}:00${value.slice(0, 10) >= "2026-11-01" ? "-07:00" : "-06:00"}`,
  );

/** Approved review records expressed using the real Calendar API fields. */
const itemStart = (item) =>
  item.allDay
    ? Date.parse(`${item.start.slice(0, 10)}T00:00:00Z`)
    : stamp(item.start);
const itemEnd = (item) =>
  item.allDay
    ? Date.parse(`${item.end.slice(0, 10)}T00:00:00Z`) + 86400000
    : stamp(item.end);

function calendarRecords() {
  return samples.items.map((item) => ({
    calendarItemId: item.id,
    scopeType: "coalition",
    scopeId: COALITION_ID,
    itemType: item.type,
    title: item.title,
    startAt: itemStart(item),
    endAt: itemEnd(item),
    startAtIso: new Date(itemStart(item)).toISOString(),
    endAtIso: new Date(itemEnd(item)).toISOString(),
    timeZone: "America/Denver",
    status: item.status,
    source: item.source.startsWith("Google") ? "provider" : "polis",
    privacy: item.privacy,
    allDay: item.allDay,
    labels: clone(item.labels),
    description: item.description,
    locationName: item.location,
    provider: item.source.startsWith("Google") ? "google" : null,
    providerCalendarId: item.source.startsWith("Google")
      ? "coalition-events"
      : null,
    externalWriteTargets: [],
    syncState: { providerWriteStatus: "not_requested" },
    createdByUserId: "alex",
  }));
}

function calendarConnections() {
  return [
    {
      connectionId: "google-connection",
      provider: "google",
      providerLabel: "Google Calendar",
      accountLabel: "Coalition events",
      status: "connected",
      lastSyncAt: Date.parse("2026-10-26T14:30:00Z"),
      calendars: [
        {
          calendarId: "coalition-events",
          title: "Coalition events",
          accessRole: "owner",
          importEnabled: true,
          writeEnabled: true,
          defaultWrite: false,
        },
      ],
      importedCalendars: [
        { calendarId: "coalition-events", title: "Coalition events" },
      ],
      writeCalendars: [
        {
          calendarId: "coalition-events",
          title: "Coalition events",
          writeEnabled: true,
        },
      ],
    },
    {
      connectionId: "microsoft-connection",
      provider: "microsoft",
      providerLabel: "Microsoft Outlook",
      accountLabel: "Community meetings",
      status: "needs_reauth",
      lastSyncAt: Date.parse("2026-10-23T22:15:00Z"),
      syncError: "Account access needs attention.",
      calendars: [
        {
          calendarId: "community-meetings",
          title: "Community meetings",
          accessRole: "reader",
          importEnabled: true,
          writeEnabled: false,
          defaultWrite: false,
        },
      ],
      importedCalendars: [
        { calendarId: "community-meetings", title: "Community meetings" },
      ],
      writeCalendars: [],
    },
  ];
}

async function mockCalendarWorkspace(
  page,
  {
    role = "admin",
    theme = "dark",
    items = null,
    membershipStatus = "active",
    omitMembership = false,
  } = {},
) {
  const permissions =
    role === "denied"
      ? []
      : role === "promotion"
        ? ["voter_map_access"]
        : ["calendar_view", "voter_map_access"];
  if (role === "manager") permissions.push("calendar_manage");
  if (role === "promotion") permissions.push("calendar_promotion_manage");
  const data = {
    role,
    actor: "alex",
    membershipStatus,
    omitMembership,
    items: clone(items || calendarRecords()),
    connections: calendarConnections(),
    requests: [],
    writes: [],
    errors: [],
    externalRequests: [],
    blockedExternalRequests: [],
    unexpectedWrites: [],
    itemFailures: 0,
    connectionFailures: 0,
    createFailures: 0,
    persistBeforeCreateFailure: false,
    itemStatus: 503,
    connectionStatus: 503,
    createStatus: 503,
    itemDelay: 0,
    connectionDelay: 0,
    createDelay: 0,
    nextReadGate: null,
    nextWriteGate: null,
    pages: null,
    pageEvaluatedCount: null,
    legacyList: false,
  };
  const coalition = {
    coalitionId: COALITION_ID,
    name: "Cedar Valley Coalition",
    coalitionType: "simple",
    description: "A shared workspace for neighborhood volunteers.",
    voterMapEnabled: true,
    timeZone: "America/Denver",
    primaryContactName: "Alex Morgan",
    email: "cedar@example.test",
  };
  const membership = () => ({
    roleKey: data.role === "admin" ? "admin" : "member",
    status: data.membershipStatus,
    permissions: data.role === "denied" ? [] : permissions,
  });
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript(
    ({ baseUrl, fixedTime, themeMode }) => {
      const token = `e30.${btoa(JSON.stringify({ sub: "alex", name: "Alex Morgan", email: "alex@example.test" }))}.test`;
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: fixedTime + 3600000,
        }),
      );
      localStorage.setItem("prefs.themeMode", themeMode);
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: baseUrl,
            auth: {
              ...value.auth,
              region: "us-west-2",
              clientId: "test",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { baseUrl: BASE_URL, fixedTime: FIXED_TIME, themeMode: theme },
  );
  page.on("pageerror", (error) => data.errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.includes("/api/")
      ? url.pathname.slice(url.pathname.indexOf("/api/"))
      : url.pathname;
    const method = request.method();
    const api = path.startsWith("/api/");
    if (url.origin !== new URL(BASE_URL).origin) {
      data.externalRequests.push({ origin: url.origin, path, api });
      if (!api) {
        if (url.hostname === "fonts.googleapis.com")
          return route.fulfill({
            status: 200,
            contentType: "text/css",
            body: "/* External font request fulfilled by the isolated fixture. */",
          });
        data.blockedExternalRequests.push(request.url());
        return route.abort("blockedbyclient");
      }
    }
    if (!api) return route.continue();
    const row = { path, query: url.search, method, headers: request.headers() };
    data.requests.push(row);
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/profile/me")
      return reply({
        profile: {
          userId: data.actor,
          displayName: data.actor === "alex" ? "Alex Morgan" : "Riley Chen",
          username: data.actor,
        },
      });
    if (path === "/api/me/policy-acceptance")
      return reply({ ok: true, accepted: true });
    if (path === "/api/coalitions" && data.omitMembership)
      return reply({ items: [] });
    if (path === "/api/coalitions")
      return reply({
        items: [
          { coalition, membership: membership() },
          {
            coalition: {
              ...coalition,
              coalitionId: "river-county",
              name: "River County Team",
            },
            membership: membership(),
          },
        ],
      });
    if (path === "/api/me/organization-workspaces" && data.omitMembership)
      return reply({ workspaces: [] });
    if (path === "/api/me/organization-workspaces")
      return reply({
        workspaces: [
          {
            scopeType: "coalition",
            scopeId: COALITION_ID,
            name: coalition.name,
            isAdmin: data.role === "admin",
            role: membership().roleKey,
            permissions: membership().permissions,
          },
        ],
      });
    const scope = path.match(/^\/api\/coalitions\/([^/]+)(?:\/(.*))?$/);
    if (scope) {
      const id = decodeURIComponent(scope[1]),
        suffix = scope[2] || "";
      if (!suffix)
        return reply({
          coalition: {
            ...coalition,
            coalitionId: id,
            name: id === COALITION_ID ? coalition.name : "River County Team",
          },
          membership: data.omitMembership ? null : membership(),
        });
      if (suffix === "members")
        return reply({
          members: [
            {
              userId: data.actor,
              displayName: "Alex Morgan",
              roleKey: membership().roleKey,
              permissions: membership().permissions,
            },
          ],
        });
      if (suffix === "access/catalog")
        return reply({
          roles: [
            { roleKey: "admin", label: "Admin", enabled: true },
            { roleKey: "member", label: "Member", enabled: true },
          ],
          canManage: data.role === "admin",
        });
      if (suffix === "voter-map/access")
        return reply({
          access: {
            ok: true,
            scope: "full",
            territories: [],
            canManageCta: data.role === "admin",
            canAccessVoterMap: true,
          },
        });
      if (
        suffix.startsWith("calendar/") &&
        (data.omitMembership || data.membershipStatus !== "active")
      )
        return reply({ error: "forbidden" }, 403);
      if (suffix === "calendar/items" && method === "GET") {
        if (data.nextReadGate) {
          const gate = data.nextReadGate;
          data.nextReadGate = null;
          await gate;
        }
        if (data.itemDelay)
          await new Promise((resolve) => setTimeout(resolve, data.itemDelay));
        if (data.itemFailures-- > 0)
          return reply(
            { error: "calendar_temporarily_unavailable" },
            data.itemStatus,
          );
        const parseBound = (name, fallback) => {
          const value = url.searchParams.get(name);
          if (value === null) return fallback;
          const parsed = /^\d+$/u.test(value)
            ? Number(value)
            : Date.parse(value);
          return Number.isFinite(parsed) ? parsed : fallback;
        };
        const from = parseBound("from", 0),
          to = parseBound("to", Infinity);
        const sourceItems =
          id === COALITION_ID
            ? data.items
            : [
                {
                  ...calendarRecords()[0],
                  calendarItemId: "river-only",
                  scopeId: id,
                  title: "River County meeting",
                  startAt: stamp("2026-10-26T12:00"),
                  endAt: stamp("2026-10-26T13:00"),
                },
              ];
        const overlap =
          url.searchParams.get("overlap") === "true" && !data.legacyList;
        if (overlap && data.pages) {
          const pageIndex =
            Number(
              (url.searchParams.get("cursor") || "page:0").split(":")[1],
            ) || 0;
          const items = data.pages[pageIndex] || [];
          return reply({
            ok: true,
            items: clone(items),
            from,
            to,
            overlap: true,
            complete: pageIndex >= data.pages.length - 1,
            nextCursor:
              pageIndex < data.pages.length - 1
                ? `page:${pageIndex + 1}`
                : null,
            pageBudget: {
              evaluatedLimit: 500,
              evaluatedCount: data.pageEvaluatedCount ?? items.length,
              returnedCount: items.length,
            },
          });
        }
        const visible = sourceItems.filter((item) =>
          overlap
            ? item.startAt < to && item.endAt > from
            : item.startAt >= from && item.startAt <= to,
        );
        return reply({
          ok: true,
          items: clone(visible),
          from,
          to,
          ...(overlap
            ? {
                overlap: true,
                complete: true,
                nextCursor: null,
                pageBudget: {
                  evaluatedLimit: 500,
                  evaluatedCount: sourceItems.length,
                  returnedCount: visible.length,
                },
              }
            : {}),
        });
      }
      if (suffix === "calendar/connections") {
        if (data.role === "promotion")
          return reply({ error: "forbidden" }, 403);
        if (data.connectionDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, data.connectionDelay),
          );
        if (data.connectionFailures-- > 0)
          return reply(
            { error: "connections_temporarily_unavailable" },
            data.connectionStatus,
          );
        return reply({
          ok: true,
          configured: true,
          connections: clone(data.connections),
          providers: [
            { provider: "google", label: "Google Calendar", configured: true },
            {
              provider: "microsoft",
              label: "Microsoft Outlook",
              configured: true,
            },
          ],
          settings: { timeZone: "America/Denver" },
        });
      }
      if (suffix === "calendar/items" && method === "POST") {
        const body = request.postDataJSON();
        const write = { ...row, body };
        data.writes.push(write);
        if (data.nextWriteGate) {
          const gate = data.nextWriteGate;
          data.nextWriteGate = null;
          await gate;
        }
        if (data.createDelay)
          await new Promise((resolve) => setTimeout(resolve, data.createDelay));
        if (!["admin", "manager", "promotion"].includes(data.role))
          return reply({ error: "forbidden" }, 403);
        const item = {
          ...body,
          calendarItemId: `created-${data.writes.length}`,
          scopeType: "coalition",
          scopeId: id,
          startAtIso: new Date(body.startAt).toISOString(),
          endAtIso: new Date(body.endAt).toISOString(),
          syncState: {
            providerWriteStatus: body.externalWriteTargets?.length
              ? "pending"
              : "not_requested",
          },
        };
        if (data.createFailures-- > 0) {
          if (data.persistBeforeCreateFailure) data.items.push(item);
          return reply({ error: "calendar_create_failed" }, data.createStatus);
        }
        data.items.push(item);
        return reply({ ok: true, item }, 201);
      }
    }
    if (method !== "GET") {
      data.unexpectedWrites.push(row);
      return reply({ error: "unexpected_fixture_write" }, 400);
    }
    return reply({
      ok: true,
      items: [],
      workspaces: [],
      members: [],
      roles: [],
    });
  });
  return data;
}

module.exports = {
  BASE_URL,
  COALITION_ID,
  COALITION_PATH,
  FIXED_TIME,
  calendarRecords,
  calendarConnections,
  mockCalendarWorkspace,
};
