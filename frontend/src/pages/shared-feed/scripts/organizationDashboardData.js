import { conversationInView, conversationUnreadCount } from "./textingFolders";
import {
  availableDashboardCards,
  checkedCount,
  hasPermission,
  personalJobProgress,
  recentActivityBars,
} from "./organizationDashboardModel";
import { checkedTextingReport } from "./textingReporting";

const closed = new Set([
  "completed",
  "approved",
  "cancelled",
  "canceled",
  "closed",
]);
const title = (value, fallback = "Update") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
const human = (value) => title(value).replaceAll(/[_:.]+/g, " ");
const list = (value) => {
  if (!Array.isArray(value)) throw new Error("Card unavailable");
  return value;
};

/** Read-only card composition; every request retains the captured actor/scope. */
export function createDashboardData({
  call,
  workspace,
  scope,
  routes,
  now = () => new Date(),
}) {
  const pending = new Map();
  const share = (key, read) => {
    if (!pending.has(key))
      pending.set(
        key,
        Promise.resolve()
          .then(read)
          .catch((error) => {
            pending.delete(key);
            throw error;
          }),
      );
    return pending.get(key);
  };
  const query = (values) =>
    new URLSearchParams(
      Object.entries(values).filter(
        ([, value]) => value !== undefined && value !== null,
      ),
    ).toString();
  const id = encodeURIComponent;
  const org = `/api/organizations/${id(scope.scopeType)}/${id(scope.scopeId)}`;
  const fieldScope =
    scope.scopeType === "candidate"
      ? { candidateId: scope.scopeId }
      : { coalitionId: scope.scopeId };
  const data = (extra) => ({ rows: [], metrics: [], ...extra });
  async function allPages(
    path,
    parameters,
    keys = ["items"],
    cursorKeys = ["nextCursor", "cursor"],
  ) {
    const rows = [],
      seen = new Set();
    let cursor;
    do {
      const page = await call(`${path}?${query({ ...parameters, cursor })}`);
      const items = keys.map((key) => page[key]).find(Array.isArray);
      rows.push(...list(items));
      cursor =
        cursorKeys
          .map((key) => page[key])
          .find((value) => value != null && value !== "") || null;
      if (cursor && (seen.has(cursor) || typeof cursor !== "string"))
        throw new Error("Card unavailable");
      if (cursor) seen.add(cursor);
      if (rows.length > 20000) throw new Error("Open this tool to see more");
    } while (cursor);
    return rows;
  }
  const missions = (view = "mine") =>
    share(`missions:${view}`, async () => {
      const rows = await allPages("/api/missions", {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        view,
        limit: 100,
      });
      if (
        rows.some(
          (row) =>
            row.scopeType !== scope.scopeType || row.scopeId !== scope.scopeId,
        )
      )
        throw new Error("Card unavailable");
      return [...new Map(rows.map((row) => [row.missionId, row])).values()];
    });
  const jobs = () =>
    share("jobs", async () =>
      (await missions())
        .flatMap((mission) =>
          list(mission.jobs || [])
            .filter((job) => job.assigneeUserId === scope.userId)
            .map((job) => ({
              ...job,
              missionId: mission.missionId,
              route: `/missions/${id(mission.missionId)}`,
            })),
        )
        .sort(
          (a, b) =>
            (Date.parse(a.dueAt) || Infinity) -
            (Date.parse(b.dueAt) || Infinity),
        ),
    );
  const field = () =>
    share("field", async () => {
      const value = await call(
        `/api/voter-map/canvassing/progress?${query({ ...fieldScope, roundId: "current", precinctId: "all", leaderboardScope: "organization" })}`,
      );
      if (
        value.status !== "ready" ||
        value.leaderboardScope?.status !== "ready" ||
        !value.totals
      )
        throw new Error("No field activity yet");
      return value;
    });
  const fieldMetrics = (value) => [
    { label: "Doors visited", value: checkedCount(value.totals.doorsKnocked) },
    { label: "Conversations", value: checkedCount(value.totals.conversations) },
    {
      label: "Literature drops",
      value: checkedCount(value.totals.literatureDropped),
    },
  ];
  const text = () =>
    share("text", async () => {
      let base = `/api/text-banking/prompt/scopes/${id(`${scope.scopeType}:${scope.scopeId}`)}`;
      const response = await call(`${base}/workspace`),
        configuration = response.workspace;
      if (
        configuration?.scopeKey !== `${scope.scopeType}:${scope.scopeId}` ||
        configuration.status !== "configured" ||
        configuration.manualOnly !== true
      )
        throw new Error("No text campaigns yet");
      if (
        configuration.capabilities?.neutralWorkspaceApi === true ||
        configuration.contractVersion === 2
      )
        base = `/api/text-banking/workspaces/${id(configuration.scopeKey)}`;
      const campaigns = await allPages(`${base}/campaigns`, { limit: 50 });
      if (
        campaigns.some(
          (campaign) =>
            campaign.scopeKey && campaign.scopeKey !== configuration.scopeKey,
        )
      )
        throw new Error("Card unavailable");
      return {
        base,
        configuration,
        campaigns: [
          ...new Map(
            campaigns
              .filter((campaign) => campaign.status !== "archived")
              .map((campaign) => [campaign.campaignId, campaign]),
          ).values(),
        ],
      };
    });
  const textReports = () =>
    share("reports", async () => {
      const value = await text();
      const selected = value.campaigns.slice(0, 3);
      const reports = await Promise.all(
        selected.map(async (campaign) => {
          if (value.configuration.capabilities?.readReporting !== true)
            return { campaign, report: null };
          try {
            const response = await call(
              `${value.base}/campaigns/${id(campaign.campaignId)}/reporting`,
            );
            return {
              campaign,
              report: checkedTextingReport(
                response.report,
                campaign.campaignId,
              ),
            };
          } catch (error) {
            if (error?.status === 401) throw error;
            return { campaign, report: null };
          }
        }),
      );
      const known = reports.filter((item) => item.report);
      const complete =
        reports.length > 0 &&
        known.length === reports.length &&
        known.every((item) => item.report.coverage === "complete");
      const counts = Object.fromEntries(
        ["delivered", "outbound", "inbound"].map((key) => [
          key,
          known.length
            ? known.reduce((sum, item) => sum + item.report.counts[key], 0)
            : value.campaigns.length === 0
              ? 0
              : null,
        ]),
      );
      return {
        ...value,
        reports,
        complete,
        counts,
        partial: !complete && value.campaigns.length > 0,
      };
    });
  const files = () =>
    share("files", async () => {
      const path = `/api/files/workspaces/${scope.scopeType === "candidate" ? "political_account" : "organization"}/${id(scope.scopeId)}`;
      const value = await call(path),
        bootstrap = value.workspace || value;
      if (
        (bootstrap.principal?.id || bootstrap.principalId) &&
        (bootstrap.principal?.id || bootstrap.principalId) !== scope.scopeId
      )
        throw new Error("Card unavailable");
      return { path, bootstrap };
    });
  const load = {
    async field() {
      const value = await field();
      return data({
        tag: "Current round",
        metrics: fieldMetrics(value),
        action: "Open field overview",
        route: routes.fieldOverview,
      });
    },
    async coverage() {
      const value = await field();
      return data({
        tag: "Current round",
        metrics: [
          {
            label: "Locations explored",
            value: checkedCount(value.totals.explored),
          },
          {
            label: "Visually canvassed",
            value: checkedCount(value.totals.visualCanvassed),
          },
          {
            label: "Doors visited",
            value: checkedCount(value.totals.doorsKnocked),
          },
        ],
        action: "View coverage",
        route: routes.field,
      });
    },
    async teams() {
      const value = await field();
      if (value.leaderboardComplete !== true)
        throw new Error("Team activity unavailable");
      const members = list(value.leaderboard);
      return data({
        tag: "Current round",
        metrics: [{ label: "Field members", value: members.length }],
        details: members.map((member) => ({
          title: title(member.displayName, "Team member"),
          note: "doors visited",
          value: checkedCount(member.doorsKnocked),
          icon: "users",
        })),
        rows: members.slice(0, 3).map((member) => ({
          title: title(member.displayName, "Team member"),
          note: "doors visited",
          value: checkedCount(member.doorsKnocked),
          icon: "users",
        })),
        action: "View field team",
        route: routes.field,
      });
    },
    async followups() {
      const rows = await allPages("/api/voter-map/canvassing/operations", {
        ...fieldScope,
        kind: "requests",
        limit: 100,
      });
      const open = rows.filter(
        (row) => !["fulfilled", ...closed].includes(row.status),
      );
      return data({
        tag: "Open requests",
        metrics: [{ label: "open follow-ups", value: open.length }],
        details: open.map((row) => ({
          title: human(row.type || "Follow-up"),
          note: title(row.addressLabel, human(row.status || "Open")),
          icon: "signpost",
        })),
        rows: open.slice(0, 3).map((row) => ({
          title: human(row.type || "Follow-up"),
          note: title(row.addressLabel, human(row.status || "Open")),
          icon: "signpost",
        })),
        action: "Review follow-ups",
        route: routes.field,
        empty: "No open follow-ups",
      });
    },
    async assignment() {
      const active = (await jobs()).filter((job) => !closed.has(job.status));
      const first = active[0];
      return data({
        tag: first?.dueAt
          ? new Date(first.dueAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : "Your assignments",
        rows: first
          ? [
              {
                title: title(first.title, "Your next task"),
                note: human(first.status),
                route: first.route,
                timestamp: first.dueAt,
              },
            ]
          : [],
        action: first ? "View assignment" : "View assignments",
        route: first?.route || routes.missions,
        empty: "No assigned tasks",
      });
    },
    async progress() {
      const value = personalJobProgress(await jobs());
      return data({
        tag: "Your tasks",
        progress: value,
        metrics: [{ label: "tasks completed", value: value.completed }],
        action: "View your progress",
        route: routes.missions,
        empty: "No assigned tasks",
      });
    },
    async schedule() {
      let rows;
      if (
        hasPermission(workspace, "calendar_view", "calendar_manage") ||
        workspace.permissions?.some((permission) =>
          permission.startsWith("calendar_"),
        )
      ) {
        const from = now(),
          to = new Date(from.getTime() + 30 * 86400000);
        rows = await allPages(routes.calendarApi, {
          from: from.toISOString(),
          to: to.toISOString(),
          limit: 100,
        });
        rows = rows
          .filter(
            (row) =>
              Date.parse(row.startAt) &&
              Date.parse(row.endAt || row.startAt) >= from.getTime() &&
              !["cancelled", "canceled", "rejected"].includes(row.status),
          )
          .map((row) => ({
            title: row.isBusyOnly ? "Busy" : title(row.title, "Event"),
            note: row.isBusyOnly ? "" : title(row.locationName, ""),
            timestamp: row.startAt,
            route: routes.calendar,
          }));
      } else
        rows = (await jobs())
          .filter((job) => !closed.has(job.status) && job.dueAt)
          .map((job) => ({
            title: title(job.title, "Task"),
            note: "Task deadline",
            timestamp: job.dueAt,
            route: job.route,
          }));
      rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      return data({
        tag: "Your calendar",
        rows: rows.slice(0, 2),
        action: "Open calendar",
        route: routes.calendar,
        empty: "Nothing coming up",
      });
    },
    async activity() {
      const permitted = availableDashboardCards(workspace);
      const other = await Promise.allSettled([
        scope.scopeType === "coalition"
          ? call(`${org}/audit?limit=50`).then((value) => {
              if (
                !value.scope ||
                value.scope.scopeType !== scope.scopeType ||
                value.scope.scopeId !== scope.scopeId
              )
                throw new Error("Card unavailable");
              return {
                events: list(value.events || value.items),
                partial: Boolean(value.nextCursor || value.scanLimited),
              };
            })
          : Promise.reject(new Error("Unavailable")),
        permitted.has("field")
          ? field()
          : Promise.reject(new Error("Unavailable")),
        permitted.has("progress")
          ? jobs()
          : Promise.reject(new Error("Unavailable")),
        permitted.has("texting")
          ? textReports()
          : Promise.reject(new Error("Unavailable")),
      ]);
      const revoked = other.find(
        (item) =>
          item.status === "rejected" &&
          [401, 403].includes(item.reason?.status),
      );
      if (revoked) throw revoked.reason;
      const events =
        other[0].status === "fulfilled" ? other[0].value.events : null;
      const fieldValue =
        other[1].status === "fulfilled"
          ? checkedCount(other[1].value.totals.doorsKnocked)
          : null;
      const taskValue =
        other[2].status === "fulfilled"
          ? personalJobProgress(other[2].value).completed
          : null;
      const textValue =
        other[3].status === "fulfilled"
          ? other[3].value.counts.delivered
          : null;
      const textPartial =
        other[3].status === "fulfilled" && other[3].value.partial;
      return data({
        tag: "Recent activity",
        bars: recentActivityBars(events || []),
        rows: (events || []).slice(0, 6).map((event) => ({
          title: human(event.action),
          note: human(event.entityType),
          timestamp: event.occurredAt,
        })),
        metrics: [
          {
            label: "Contributors",
            value: events
              ? new Set(
                  events
                    .map((event) => event.actorUserId)
                    .filter(
                      (actor) => typeof actor === "string" && actor.trim(),
                    ),
                ).size
              : null,
            note: "Recent activity",
          },
          { label: "Doors visited", value: fieldValue, note: "Current round" },
          {
            label: "Texts delivered",
            value: textValue,
            partial: textPartial && textValue !== null,
            note: textPartial ? "Available reports" : "Recent campaigns",
          },
          { label: "Your tasks completed", value: taskValue, note: "All time" },
        ],
        action: "View activity",
        route: routes.audit,
        empty: events ? "No recent activity" : "Activity unavailable",
      });
    },
    async attention() {
      const groups = [];
      if (
        hasPermission(
          workspace,
          "missions_assign",
          "missions_delegate",
          "missions_approve",
          "missions_manage",
          "mission_templates_manage",
        )
      )
        groups.push({
          key: "missions",
          title: "Tasks to review",
          icon: "check-circle",
          route: routes.reviewTasks,
          read: async () => {
            const pending = await missions("attention");
            return {
              value: pending.length,
              items: pending.slice(0, 2).map((mission) => ({
                title: title(mission.title, "Task to review"),
                note: "Task review",
                icon: "check-circle",
                route: `/missions/${id(mission.missionId)}`,
              })),
            };
          },
        });
      if (
        workspace.features?.organizationPublishing === true &&
        hasPermission(workspace, "posts_approve_manage")
      )
        groups.push({
          key: "posts",
          title: "Posts to review",
          icon: "messages",
          route: routes.publishing,
          read: async () => {
            const drafts = (
              await allPages(`${org}/post-drafts`, { limit: 100 }, [
                "drafts",
                "items",
              ])
            ).filter((row) =>
              ["submitted", "pending_approval", "publication_failed"].includes(
                row.state,
              ),
            );
            return {
              value: drafts.length,
              items: drafts
                .filter((draft) => draft.draftId)
                .slice(0, 2)
                .map((draft) => ({
                  title: title(
                    draft.description ||
                      draft.content?.description ||
                      draft.content?.title,
                    "Post to review",
                  ).slice(0, 90),
                  note:
                    draft.state === "publication_failed"
                      ? "Publishing failed"
                      : "Post review",
                  icon: "messages",
                  route: `${routes.publishing}/drafts/${id(draft.draftId)}`,
                })),
            };
          },
        });
      if (
        hasPermission(workspace, "files_review") &&
        workspace.features?.organizationFiles
      )
        groups.push({
          key: "files",
          title: "File proposals",
          icon: "folder",
          route: routes.files,
          read: async () => {
            const { bootstrap } = await files();
            return {
              value: checkedCount(bootstrap.pendingCounts?.proposals),
              items: [],
            };
          },
        });
      const results = await Promise.allSettled(
        groups.map((group) => group.read()),
      );
      const revoked = results.find(
        (result) =>
          result.status === "rejected" &&
          [401, 403].includes(result.reason?.status),
      );
      if (revoked) throw revoked.reason;
      const allRows = groups.map((group, index) => ({
        key: group.key,
        title: group.title,
        icon: group.icon,
        route: group.route,
        value:
          results[index].status === "fulfilled"
            ? checkedCount(results[index].value.value)
            : null,
      }));
      allRows.forEach((row) => {
        if (row.value === null) row.note = "Unavailable";
      });
      const unknownGroups = allRows.filter((row) => row.value === null).length;
      const knownTotal = allRows.reduce(
        (sum, row) => sum + (row.value || 0),
        0,
      );
      const allClear =
        allRows.length > 0 && unknownGroups === 0 && knownTotal === 0;
      return data({
        tag: allClear
          ? "All clear"
          : knownTotal > 0
            ? `${knownTotal} waiting`
            : "Reviews",
        rows: allRows.filter((row) => row.value === null || row.value > 0),
        allRows,
        priorityItems: results
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => result.value.items)
          .slice(0, 4),
        knownTotal,
        unknownGroups,
        allClear,
        action: "Review priorities",
        route: routes.priorities,
        empty: allClear ? "No reviews waiting" : "No review summary available",
      });
    },
    async texting() {
      const value = await textReports();
      const activeCampaigns = value.campaigns.filter(
        (campaign) => campaign.status === "active",
      ).length;
      const pausedCampaigns = value.campaigns.filter(
        (campaign) => campaign.status === "paused",
      ).length;
      const { delivered, outbound, inbound } = value.counts;
      return data({
        tag: value.complete
          ? `${value.reports.length} campaigns`
          : `${activeCampaigns} active`,
        activeCampaigns,
        pausedCampaigns,
        campaignCount: value.campaigns.length,
        partial: value.partial,
        metrics: [
          { label: "active campaigns", value: activeCampaigns },
          {
            label: "Delivered",
            value: delivered,
            partial: value.partial && delivered !== null,
          },
          {
            label: "Replies received",
            value: inbound,
            partial: value.partial && inbound !== null,
          },
        ],
        ratio:
          value.complete &&
          delivered !== null &&
          outbound > 0 &&
          delivered <= outbound
            ? {
                value: delivered,
                total: outbound,
                percent: (delivered * 100) / outbound,
              }
            : null,
        rows: value.reports.map(({ campaign, report }) => ({
          title: title(campaign.name, "Campaign"),
          note: human(campaign.status || "Draft"),
          value: report ? checkedCount(report.counts.delivered) : null,
          partial: report?.coverage === "partial",
          route: routes.texting,
          icon: "messages",
        })),
        action: "View campaigns",
        route: routes.texting,
        empty: "No current campaigns",
      });
    },
    async textTeam() {
      const value = await text(),
        assigned = new Set(
          value.campaigns.flatMap((campaign) => campaign.assignedUserIds || []),
        );
      return data({
        tag: "Current campaigns",
        metrics: [{ label: "assigned texters", value: assigned.size }],
        rows: value.campaigns.slice(0, 3).map((campaign) => ({
          title: title(campaign.name, "Campaign"),
          note: `${new Set(campaign.assignedUserIds || []).size} assigned`,
          icon: "users",
        })),
        action: "View texting team",
        route: routes.texting,
        empty: "No current campaigns",
      });
    },
    async replies() {
      const value = await text(),
        page = await call(`${value.base}/conversations?folder=replies&limit=3`);
      const rows = list(page.items).filter(
        (row) =>
          conversationInView(row, { folder: "replies" }) &&
          conversationUnreadCount(row) > 0,
      );
      return data({
        tag: "Unread replies",
        rows: rows.slice(0, 3).map((row) => ({
          title: title(row.displayName || row.contactName, "Conversation"),
          note: "Reply waiting",
          value: conversationUnreadCount(row),
          icon: "messages",
          route: routes.replies,
        })),
        action: "Open reply queue",
        route: routes.replies,
        empty: "No unread replies",
      });
    },
    async updates() {
      const value = await call(
        `/api/me/notifications?${query({ scopeType: scope.scopeType, scopeId: scope.scopeId, limit: 3 })}`,
      );
      if (value.scopeKey !== `${scope.scopeType}:${scope.scopeId}`)
        throw new Error("Card unavailable");
      return data({
        tag: "Latest update",
        rows: list(value.items)
          .slice(0, 1)
          .map((row) => ({
            title: title(
              row.preview?.textSnippet || row.title,
              human(row.kind || "Team update"),
            ),
            note: row.authorName || "",
            timestamp: row.lastEventTs,
            icon: "megaphone",
          })),
        action: "View team update",
        route: routes.updates,
        empty: "No team updates yet",
      });
    },
    async files() {
      const { path } = await files(),
        value = await call(`${path}/folders?view=recent&limit=2`);
      return data({
        tag: "Recent folders",
        rows: list(value.folders || value.items || value.page?.items)
          .slice(0, 2)
          .map((row) => ({
            title: title(row.name, "Folder"),
            note: "Shared with you",
            icon: "folder",
            route: routes.files,
          })),
        action: "Open Files",
        route: routes.files,
        empty: "No recent folders",
      });
    },
  };
  return { load: (card) => load[card]() };
}
