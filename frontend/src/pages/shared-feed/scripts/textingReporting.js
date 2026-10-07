import {
  escapeText as e,
  id,
  list,
  button,
  go,
  stat,
  notice,
} from "./textingWorkspaceUi";

const keys = [
  "accepted",
  "sent",
  "delivered",
  "failed",
  "pending",
  "needsReview",
  "inbound",
  "outbound",
];
export function checkedTextingReport(report, campaignId) {
  if (
    report?.version !== 1 ||
    report.campaignId !== campaignId ||
    !["complete", "partial"].includes(report.coverage) ||
    keys.some(
      (key) =>
        !Number.isSafeInteger(report.counts?.[key]) || report.counts[key] < 0,
    ) ||
    !Number.isSafeInteger(report.unreadReplies) ||
    report.unreadReplies < 0
  )
    throw new Error("Campaign reporting could not be verified.");
  return report;
}
export const textingHistoryStatus = (status) =>
  ({
    received: "Reply received",
    accepted: "Accepted · delivery pending",
    sent: "Sent · delivery pending",
    delivered: "Delivered",
    failed: "Failed",
    needs_review: "Needs review",
  })[status] || "Status pending";
export function renderTextingReport(report, { compact = false } = {}) {
  if (report === null)
    return '<p class="pt-muted">Counts are temporarily unavailable. Refresh to try again.</p>';
  if (!report) return "";
  const c = report.counts;
  if (compact)
    return `<p class="pt-muted">${e(c.delivered)} delivered · ${e(report.unreadReplies)} unread to you${report.coverage === "partial" ? " · Partial history" : ""}</p>`;
  return `<section class="pt-card" aria-label="Campaign reporting"><h2>Campaign activity</h2><div class="pt-grid pt-grid--three">${stat("Accepted", c.accepted)}${stat("Sent · awaiting delivery", c.sent)}${stat("Delivered", c.delivered)}${stat("Failed", c.failed)}${stat("Status pending", c.pending)}${stat("Needs review", c.needsReview)}${stat("Replies received", c.inbound)}${stat("Unread to you", report.unreadReplies)}</div><p class="pt-muted">Accepted does not mean delivered. Counts reflect recorded message evidence.${report.coverage === "partial" ? " Earlier activity may be missing." : ""}</p>${Number.isSafeInteger(report.asOfMs) ? `<p class="pt-muted">Updated ${e(new Date(report.asOfMs).toLocaleString())}</p>` : ""}</section>`;
}

/** Current scoped reads only. No queue allocation, confirmation or financial
 * fields participate in activity reporting. */
export async function readTextingReports(r, campaigns) {
  const result = {};
  if (!r.can("readReporting")) return result;
  // Bounded concurrency keeps a full campaign page from bursting the API.
  for (let offset = 0; offset < campaigns.length; offset += 4) {
    await Promise.all(
      campaigns.slice(offset, offset + 4).map(async (campaign) => {
        try {
          const response = await r.api(
            `/campaigns/${id(campaign.campaignId)}/reporting`,
          );
          r.guard();
          result[campaign.campaignId] = checkedTextingReport(
            response.report,
            campaign.campaignId,
          );
        } catch (error) {
          r.guard();
          if ([401, 403].includes(error?.status)) throw error;
          result[campaign.campaignId] = null;
        }
      }),
    );
  }
  return result;
}

export function createTextingHistory(r, state) {
  let readScheduled = false;
  async function load({ more = false } = {}) {
    const s = state(),
      campaignId = s.campaign?.campaignId;
    if (!campaignId || !r.can("readReporting")) return;
    s.history ||= { items: [], direction: "outbound", status: "", days: "" };
    const h = s.history,
      query = new URLSearchParams();
    if (more && h.cursor) query.set("cursor", h.cursor);
    if (h.direction) query.set("direction", h.direction);
    if (h.status) query.set("status", h.status);
    if (h.days)
      query.set("fromMs", String(Date.now() - Number(h.days) * 86400000));
    const response = await r.api(
      `/campaigns/${id(campaignId)}/history?${query}`,
    );
    r.guard();
    if (list(response.items).some((item) => item.campaignId !== campaignId))
      throw new Error("History does not match this campaign.");
    const items = new Map(
      (more ? h.items : []).map((item) => [item.entryId, item]),
    );
    for (const item of list(response.items)) items.set(item.entryId, item);
    h.items = [...items.values()];
    h.cursor = response.nextCursor;
    if (!more) h.readTokens = new Set();
    if (response.readToken)
      (h.readTokens ||= new Set()).add(response.readToken);
    s.reports = await readTextingReports(r, [s.campaign]);
  }
  function acknowledgeVisibleHistory() {
    const s = state(),
      h = s.history;
    if (
      readScheduled ||
      !h?.readTokens?.size ||
      typeof requestAnimationFrame !== "function"
    )
      return;
    readScheduled = true;
    requestAnimationFrame(async () => {
      readScheduled = false;
      if (document.hidden || state().history !== h) return;
      try {
        r.guard();
        for (const readToken of h.readTokens) {
          h.readTokens.delete(readToken);
          const response = await r.api(
            `/campaigns/${id(s.campaign.campaignId)}/history/read`,
            { readToken },
          );
          r.guard();
          s.reports[s.campaign.campaignId] = checkedTextingReport(
            response.report,
            s.campaign.campaignId,
          );
        }
        h.readError = false;
      } catch (error) {
        try {
          r.guard();
        } catch {
          return;
        }
        if ([401, 403].includes(error?.status)) r.fail(error);
        else h.readError = true;
      }
      r.changed();
    });
  }
  function render() {
    if (!r.can("readReporting"))
      return notice(
        "Reporting is unavailable",
        "Refresh your workspace after the reporting update is available.",
      );
    const s = state(),
      h = s.history || { items: [] };
    acknowledgeVisibleHistory();
    const options = (name, values, selected) =>
      `<label class="pt-field">${e(name)}<select data-workspace-history-filter="${e(name)}"${r.busy() ? " disabled" : ""}>${values.map(([value, label]) => `<option value="${e(value)}"${value === (selected || "") ? " selected" : ""}>${e(label)}</option>`).join("")}</select></label>`;
    return `${h.readError ? notice("Unread status could not be saved", "Refresh history to try again.") : ""}${renderTextingReport(s.reports?.[s.campaign.campaignId])}<section class="pt-card"><div class="pt-row"><h2>Message history</h2>${button("report-history-refresh", "Refresh history", { secondary: true })}</div><p class="pt-muted">Saved messages across sessions. Pending outcomes remain visible until evidence resolves them.</p><div class="pt-fields">${options(
      "Direction",
      [
        ["outbound", "Sent history"],
        ["inbound", "Replies"],
        ["", "All messages"],
      ],
      h.direction,
    )}${options(
      "Status",
      [
        ["", "All statuses"],
        ["accepted", "Accepted"],
        ["sent", "Sent"],
        ["delivered", "Delivered"],
        ["failed", "Failed"],
        ["pending", "Status pending"],
        ["needs_review", "Needs review"],
      ],
      h.status,
    )}${options(
      "Dates",
      [
        ["", "All dates"],
        ["7", "Last 7 days"],
        ["30", "Last 30 days"],
      ],
      h.days,
    )}</div>${button("report-history-apply", "Apply filters", { secondary: true })}${
      h.items.length
        ? [...h.items]
            .sort((a, b) => b.createdAtMs - a.createdAtMs)
            .map(
              (item) =>
                `<article class="pt-row"><div><strong>${e(item.displayName || "Recipient")}</strong><p class="pt-muted">${e(textingHistoryStatus(item.status))} · ${e(new Date(item.createdAtMs).toLocaleString())}</p><p>${e(item.content)}</p>${item.hasMedia ? '<p class="pt-muted">Includes an attachment</p>' : ""}</div>${item.conversationId ? go("conversation", "Open conversation", item.conversationId, true) : '<span class="pt-muted">Conversation updating</span>'}</article>`,
            )
            .join("")
        : '<p class="pt-muted">No recorded messages on this page match these filters.</p>'
    }${h.cursor ? button("report-history-more", "Load more history", { secondary: true }) : ""}</section>`;
  }
  async function action(name) {
    if (
      ![
        "report-history-more",
        "report-history-refresh",
        "report-history-apply",
      ].includes(name)
    )
      return false;
    await load({ more: name === "report-history-more" });
    return true;
  }
  function change(target) {
    const key = { Direction: "direction", Status: "status", Dates: "days" }[
      target.dataset?.workspaceHistoryFilter
    ];
    if (!key) return false;
    state().history[key] = target.value;
    return false; // Keep focus and let Apply perform the authoritative read.
  }
  return { load, render, action, change };
}
