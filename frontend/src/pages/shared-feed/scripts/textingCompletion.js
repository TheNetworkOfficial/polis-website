import "../css/texting-completion.css";
import { escapeText as e, count, button, id } from "./textingWorkspaceUi";

const states = new Set([
  "campaign_complete",
  "batch_complete",
  "waiting",
  "review_required",
  "in_progress",
  "unavailable",
  "archived",
]);
const coverage = new Set(["complete", "partial", "unavailable"]);
const countKeys = [
  "accepted",
  "delivered",
  "failed",
  "pending",
  "needsReview",
  "inbound",
];
const known = (value) => Number.isSafeInteger(value) && value >= 0;
const validCounts = (value) =>
  value === null || (value && countKeys.every((key) => known(value[key])));

/** Completion proof is independent from the coverage of message history. */
export function checkedTextingCompletion(
  value,
  campaignId,
  actorUserId,
  allocationId,
) {
  if (
    value?.version !== 1 ||
    value.campaignId !== campaignId ||
    !known(value.campaignRevision) ||
    !states.has(value.state) ||
    !known(value.asOfMs) ||
    typeof value.canArchive !== "boolean" ||
    value.personal?.actorUserId !== actorUserId ||
    typeof value.personal?.batchComplete !== "boolean" ||
    !coverage.has(value.personal?.coverage) ||
    !validCounts(value.personal?.counts) ||
    !coverage.has(value.results?.campaign?.coverage) ||
    !validCounts(value.results?.campaign?.counts) ||
    typeof value.campaign?.verified !== "boolean" ||
    ["audienceTotal", "worked", "remaining", "unresolved"].some(
      (key) => value.campaign[key] !== null && !known(value.campaign[key]),
    )
  )
    throw new Error("Campaign results could not be verified.");
  if (
    value.state === "campaign_complete" &&
    (typeof value.proofId !== "string" ||
      !value.proofId ||
      !value.campaign.verified ||
      value.campaign.remaining !== 0 ||
      value.campaign.unresolved !== 0)
  )
    throw new Error("Campaign completion could not be verified.");
  if (
    value.state === "batch_complete" &&
    (value.personal.batchComplete !== true ||
      !value.personal.allocationId ||
      (allocationId && value.personal.allocationId !== allocationId))
  )
    throw new Error("Your finished batch could not be verified.");
  if (
    value.canArchive &&
    (value.state !== "campaign_complete" ||
      typeof value.proofId !== "string" ||
      !value.proofId)
  )
    throw new Error("Campaign closure could not be verified.");
  return value;
}

const mark = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{ check: '<path d="m5 12 4 4L19 6"/>', chat: '<path d="M20 11a7 7 0 0 1-7 7H8l-5 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4Z"/>', archive: '<path d="M4 9h16v11H4zM3 4h18v5H3zM9 13h6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', send: '<path d="m3 10 18-7-7 18-3-8-8-3Zm8 3L21 3"/>', team: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>' }[name] || '<circle cx="12" cy="12" r="9"/>'}</svg>`;
export const completionScene = (celebrate) =>
  `<svg class="pt-finish-scene" viewBox="0 0 320 220" fill="none" aria-hidden="true"><ellipse cx="160" cy="195" rx="135" ry="9" fill="currentColor" opacity=".05"/><path d="M27 195h266" stroke="currentColor" opacity=".2"/><g class="pt-finish-podium"><path d="M34 149a10 10 0 0 1 10-10h70v55H44a10 10 0 0 1-10-10Zm80-21a12 12 0 0 1 12-12h68a12 12 0 0 1 12 12v66h-92Zm92 27h70a10 10 0 0 1 10 10v19a10 10 0 0 1-10 10h-70Z"/><path d="M151 169h18m-100 5h10m162 5h10"/></g><g class="pt-finish-bubble pt-finish-left"><path d="M55 80h34a16 16 0 0 1 16 16v15a16 16 0 0 1-16 16H72l-12 9v-9h-5a16 16 0 0 1-16-16V96a16 16 0 0 1 16-16Z"/><path d="M54 100h33m-33 9h22"/></g><g class="pt-finish-bubble pt-finish-right"><path d="M231 96h33a16 16 0 0 1 16 16v14a16 16 0 0 1-16 16h-3v9l-12-9h-18a16 16 0 0 1-16-16v-14a16 16 0 0 1 16-16Z"/><path d="M231 116h33m-33 9h22"/></g><g class="pt-finish-bubble pt-finish-main"><path d="M133 36h54a23 23 0 0 1 23 23v36a23 23 0 0 1-23 23h-36l-18 13v-13a23 23 0 0 1-23-23V59a23 23 0 0 1 23-23Z"/>${celebrate ? '<circle class="pt-finish-ring" cx="160" cy="77" r="25" pathLength="100"/><path class="pt-finish-check" d="m148 77 9 8 15-16" pathLength="100"/>' : '<circle cx="140" cy="77" r="3"/><circle cx="160" cy="77" r="3"/><circle cx="180" cy="77" r="3"/>'}</g>${celebrate ? '<g class="pt-finish-rays"><path d="m89 40-7-7m23-12-3-8m55 5v-8m61 18 5-8m11 35 9-3m-170 12-7-1"/></g>' : ""}</svg>`;

const celebrated = new Set();

export function createTextingCompletion(r, state) {
  let disposed = false,
    generation = 0,
    pendingRead = null,
    focusTimer;
  function focusConfirmation() {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      try {
        r.guard();
        if (!disposed && state().completionDialog)
          globalThis.document
            ?.querySelector(
              '[data-workspace-action="completion-cancel-archive"]',
            )
            ?.focus();
      } catch {
        /* A different route owns focus now. */
      }
    }, 0);
  }
  const onKey = (event) => {
    if (disposed || !state().completionDialog) return;
    try {
      r.guard();
    } catch {
      return;
    }
    const panel = globalThis.document?.querySelector(".pt-completion-confirm");
    if (!panel) return;
    if (event.key === "Escape" && !state().completionSubmitting) {
      event.preventDefault();
      localAction("completion-cancel-archive");
      r.changed();
    } else if (event.key === "Tab") {
      const buttons = [...panel.querySelectorAll("button:not(:disabled)")],
        first = buttons[0],
        last = buttons.at(-1);
      if (!panel.contains(globalThis.document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (
        event.shiftKey &&
        globalThis.document.activeElement === first
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        globalThis.document.activeElement === last
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  globalThis.document?.addEventListener?.("keydown", onKey);
  const current = (version, campaignId) => {
    r.guard();
    return (
      !disposed &&
      version === generation &&
      state().campaign?.campaignId === campaignId
    );
  };
  const blockedLocally = () =>
    Boolean(
      state().pendingItems?.size ||
        state().pendingItemId ||
        state().queue?.items?.length,
    );
  const fresh = () =>
    !state().completionError &&
    !state().completionLoading &&
    known(state().completion?.asOfMs) &&
    Date.now() - state().completion.asOfMs <= 120000 &&
    state().completion.asOfMs <= Date.now() + 30000;
  async function load({ finish = false } = {}) {
    const s = state(),
      campaignId = s.campaign?.campaignId;
    if (!campaignId || !r.context?.()?.userId) return;
    if (pendingRead) return pendingRead;
    const version = ++generation;
    s.completionLoading = true;
    pendingRead = (async () => {
      try {
        const response = await r.api(`/campaigns/${id(campaignId)}/completion`);
        if (!current(version, campaignId)) return;
        s.completion = checkedTextingCompletion(
          response.completion,
          campaignId,
          r.context().userId,
          s.queue?.allocationId,
        );
        s.completionError = false;
        s.completionChanged = false;
      } catch (error) {
        if (!current(version, campaignId)) return;
        s.completionError = true;
        s.completionChanged =
          (error?.payload?.error || error?.code) ===
          "prompt_campaign_completion_changed";
        if ([401, 403].includes(error?.status)) {
          s.completion = null;
          s.completionDialog = false;
          throw error;
        }
      } finally {
        if (current(version, campaignId)) {
          s.completionLoading = false;
          if (
            finish &&
            (s.queue ||
              [
                "campaign_complete",
                "batch_complete",
                "review_required",
                "archived",
              ].includes(s.completion?.state))
          )
            s.completionFinish = true;
        }
      }
    })();
    try {
      await pendingRead;
    } finally {
      pendingRead = null;
    }
  }
  const metric = (label, value) =>
    `<div><strong>${count(value)}</strong><span>${e(label)}</span></div>`;
  const exit = () =>
    button("queue-leave", "Exit campaign", { value: "", secondary: true });
  function finish() {
    const s = state(),
      c = s.completion,
      status = fresh() ? c?.state || "unavailable" : "unavailable",
      saved = Boolean(c) && !fresh();
    const complete = status === "campaign_complete",
      batch = status === "batch_complete",
      celebrate = complete || batch;
    const animationKey = celebrate
      ? `${r.context().userId}:${r.context().organizationId}:${c.campaignId}:${c.proofId || c.personal.allocationId}`
      : null;
    const animate = celebrate && !celebrated.has(animationKey);
    if (animate) {
      celebrated.add(animationKey);
      if (celebrated.size > 128)
        celebrated.delete(celebrated.values().next().value);
    }
    const admin = r.can("createCampaigns"),
      team = admin && (complete || (saved && c.state === "campaign_complete")),
      candidate = team ? c.results.campaign : c?.personal,
      metrics = candidate?.coverage === "unavailable" ? null : candidate;
    const title = saved
      ? "Your latest saved results."
      : status === "archived"
        ? "A good finish. All saved."
        : complete
          ? team
            ? "You did this. Together."
            : "Look what you did."
          : batch
            ? "You finished your batch."
            : status === "review_required"
              ? "A few need a second look."
              : status === "unavailable"
                ? "Your results aren’t available."
                : "You’re caught up for now.";
    return `<section class="pt-completion pt-completion--finish${animate ? " pt-completion--animate" : ""}" aria-label="Texting completion"><p class="pt-completion-campaign">${mark("chat")}${e(s.campaign.name)}</p>${completionScene(celebrate || (saved && ["campaign_complete", "batch_complete"].includes(c.state)))}<span class="pt-completion-badge${status === "review_required" ? " pt-completion-badge--review" : ""}">${e(saved ? "Previous results" : complete ? "Campaign texting finished" : batch ? "Your batch is finished" : status === "archived" ? "Archived" : status === "review_required" ? "Needs review" : status === "unavailable" ? "Results unavailable" : "Taking a breather")}</span><h1>${e(title)}</h1><p class="pt-muted">${e(saved ? (s.completionLoading ? "Updating these saved results." : "You can check again or leave.") : complete ? "Every text. Every teammate. One shared effort." : batch ? "Ready for another?" : status === "review_required" ? "Some send outcomes are not confirmed. Do not send them again." : status === "unavailable" ? "You can exit and check back later." : "Other volunteers may still be working.")}</p>${metrics?.counts ? `<div class="pt-completion-total">${count(metrics.counts.accepted)}</div><p class="pt-muted">${team ? "texts sent by the team" : "texts sent by you"}${metrics.coverage === "partial" ? " · recorded so far" : ""}</p><div class="pt-completion-stats">${metric("Delivered", metrics.counts.delivered)}${team || c.personal.inboundAvailable !== false ? metric("Incoming messages", metrics.counts.inbound) : ""}</div>` : ""}${s.completionError && c ? '<p class="pt-muted" role="status">Previous results · Unable to refresh</p>' : ""}<div class="pt-completion-actions">${!complete && !["archived", "review_required"].includes(status) && s.campaign.canFetchQueue && r.can("manualQueue") ? button("queue-load", "Get next recipients", { disabled: r.busy() }) : ""}${button("completion-results", admin && complete ? "Review campaign" : "See your results", { value: admin && complete ? "campaign" : "personal" })}${status === "review_required" ? button("completion-review", "Review sends", { secondary: true }) : ""}${!celebrate && status !== "archived" ? button("completion-refresh", "Check again", { secondary: true, disabled: r.busy() }) : ""}${exit()}</div></section>`;
  }
  function delivery(metrics) {
    const c = metrics?.counts;
    if (!c)
      return '<section class="pt-card"><h2>Delivery</h2><p class="pt-muted">Results unavailable</p></section>';
    const denominator =
      metrics.coverage === "complete" &&
      known(c.accepted) &&
      c.accepted > 0 &&
      known(c.delivered) &&
      c.delivered <= c.accepted;
    const percentage = denominator
      ? Math.round((c.delivered / c.accepted) * 100)
      : null;
    const final =
      metrics.coverage === "complete" && c.pending === 0 && c.needsReview === 0;
    return `<section class="pt-card pt-completion-delivery"><h2>Delivery</h2><div class="pt-completion-delivery-body">${percentage !== null ? `<svg class="pt-completion-donut" viewBox="0 0 120 120" role="img" aria-label="${percentage}% delivered"><circle class="pt-completion-ring-track" cx="60" cy="60" r="48"/><circle class="pt-completion-ring-value" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${percentage} 100"/><text x="60" y="60">${percentage}%</text><text class="pt-completion-donut-label" x="60" y="78">delivered</text></svg>` : ""}<div class="pt-completion-legend">${metric("Delivered", c.delivered)}${metric("Not delivered", c.failed)}${!final ? metric("Delivery pending", c.pending) : ""}</div></div><p class="pt-muted">${metrics.coverage === "partial" ? "Partial history · recorded results so far." : final ? "Delivery results are in." : "Latest confirmed delivery results."}</p></section>`;
  }
  function results() {
    const s = state(),
      c = s.completion,
      personal = s.completionScope !== "campaign",
      metrics = personal ? c?.personal : c?.results?.campaign,
      data = metrics?.counts;
    const admin = r.can("createCampaigns"),
      canArchive =
        admin &&
        c?.canArchive === true &&
        fresh() &&
        !blockedLocally() &&
        !s.completionArchiveUnknown;
    return `<section class="pt-completion pt-completion--results" aria-label="Campaign results"><header class="pt-completion-heading"><div><h1>${personal ? "Your impact" : "Look what we did."}</h1><p class="pt-muted">${e(s.campaign.name)}</p></div>${button("completion-refresh", "Refresh results", { secondary: true, disabled: r.busy() })}</header><nav class="pt-completion-tabs" aria-label="Results scope">${["personal", "campaign"].map((scope) => button("completion-scope", scope === "personal" ? "Your impact" : "Campaign", { value: scope, secondary: s.completionScope !== scope }).replace("<button ", `<button aria-pressed="${(s.completionScope || "personal") === scope}" `)).join("")}</nav>${s.completionError && c ? '<p class="pt-notice" role="status">Previous results · Unable to refresh. Close & archive is held.</p>' : ""}${!c || !data ? `<div class="pt-notice" role="status"><strong>Results unavailable</strong><p>${s.completionChanged ? "Delivery results changed while this page was loading. Refresh results to try again." : "Refresh results to try again. This does not mean your sending history is missing."}</p></div>` : `<div class="pt-completion-grid"><section class="pt-card pt-completion-sent"><span>${mark("send")}Texts sent</span><strong>${count(data.accepted)}</strong><p class="pt-muted">${metrics.coverage === "partial" ? "Recorded so far · partial history" : personal ? "Your part in a team effort." : "One team. A lot of good work."}</p></section>${delivery(metrics)}${!personal || c.personal.inboundAvailable !== false ? `<section class="pt-card pt-completion-replies"><span>${mark("chat")}Incoming messages</span><strong>${count(data.inbound)}</strong><p class="pt-muted">Includes opt-outs and replies, not unique people.</p></section>` : ""}${c.results.team?.contributorCount !== undefined && known(c.results.team.contributorCount) ? `<section class="pt-card pt-completion-team"><span>${mark("team")}Team</span><strong>${count(c.results.team.contributorCount)}</strong><p class="pt-muted">${c.results.campaign.coverage === "partial" ? "Recorded contributors" : "Volunteers who sent"}</p></section>` : ""}${renderSeries(c, personal)}${renderShare(c)}${(known(data.needsReview) && data.needsReview > 0) || c.state === "review_required" ? `<section class="pt-notice pt-completion-review"><strong>${known(data.needsReview) ? `${count(data.needsReview)} messages need review` : "Some sends need review"}</strong><p>Send outcomes aren’t confirmed yet.</p>${button("completion-review", "Review sends", { secondary: true })}</section>` : ""}</div>`}<details class="pt-completion-about"><summary>About these results</summary><p class="pt-muted">Sent counts accepted submissions, not delivery. Incoming counts include opt-outs and reply messages, not unique people. Outbound totals include follow-up replies. Delivery can update after texting finishes.</p></details><p class="pt-muted pt-completion-updated">${c ? `Updated ${e(new Date(c.asOfMs).toLocaleString(undefined, { hour12: true }))}` : ""}</p>${s.completionArchiveUnknown ? '<div class="pt-notice" role="alert"><strong>Closure needs checking</strong><p>The saved campaign status could not be confirmed. Refresh before closing again.</p></div>' : ""}<footer class="pt-completion-actions">${admin && s.campaign.status !== "archived" ? `<p class="pt-muted">${canArchive ? "Sending finished. Results stay saved." : "Campaign work may still need attention."}</p>${button("completion-archive", "Close & archive", { disabled: !canArchive || r.busy() })}` : s.campaign.status === "archived" ? '<p class="pt-completion-badge">Archived · Sending and replies closed</p>' : ""}${exit()}${button("completion-finish", "Back to your finish", { secondary: true })}</footer>${s.completionDialog ? dialog(canArchive) : ""}</section>`;
  }
  function renderSeries(c, personal) {
    const series = c.results.series;
    if (!Array.isArray(series) || !series.length || series.length > 48)
      return "";
    const key = personal ? "personalAccepted" : "campaignAccepted";
    if (series.some((point) => !known(point[key]) || !known(point.hourStartMs)))
      return "";
    const maximum = Math.max(1, ...series.map((point) => point[key]));
    return `<section class="pt-card pt-completion-activity"><h2>${personal ? "Your momentum" : "Team momentum"}</h2><p class="pt-muted">Texts sent · ${e(new Date(series[0].hourStartMs).toLocaleDateString())}</p><svg viewBox="0 0 ${series.length * 48} 110" role="img" aria-label="${e(series.map((point) => `${new Date(point.hourStartMs).toLocaleTimeString([], { hour: "numeric", hour12: true })}: ${point[key]} sent`).join("; "))}">${series.map((point, i) => `<rect x="${i * 48 + 8}" y="${78 - (point[key] / maximum) * 64}" width="30" height="${(point[key] / maximum) * 64}" rx="5"/><text x="${i * 48 + 23}" y="102">${e(new Date(point.hourStartMs).toLocaleTimeString([], { hour: "numeric", hour12: true }))}</text>`).join("")}</svg></section>`;
  }
  function renderShare(c) {
    const own = c.personal.counts?.accepted,
      total = c.results.campaign.counts?.accepted;
    if (
      c.personal.coverage !== "complete" ||
      c.results.campaign.coverage !== "complete" ||
      !known(own) ||
      !known(total) ||
      total <= 0 ||
      own > total
    )
      return "";
    return `<section class="pt-card pt-completion-share"><h2>Your part</h2><p class="pt-muted">${count(own)} of ${count(total)} texts</p><progress value="${own}" max="${total}" aria-label="Your share of campaign texts"></progress><strong>${Math.round((own / total) * 100)}%</strong></section>`;
  }
  function dialog(canArchive) {
    return `<div class="pt-completion-scrim"><section class="pt-completion-confirm pt-card" role="dialog" aria-modal="true" aria-labelledby="pt-completion-close-title"><div>${mark("archive")}</div><h2 id="pt-completion-close-title">Close this campaign?</h2><p>${e(state().campaign.name)}</p><ul><li>New texts stop</li><li>Replies close</li><li>Results & history stay saved</li></ul><p class="pt-muted">This campaign can’t be reopened. You can still read its conversations.</p><div class="pt-actions">${button("completion-confirm-archive", "Close & archive", { disabled: !canArchive || r.busy() })}${button("completion-cancel-archive", "Keep open", { secondary: true, disabled: state().completionSubmitting })}</div></section></div>`;
  }
  async function action(name) {
    const s = state();
    if (name === "completion-refresh") {
      await load();
      if (s.completion?.state === "archived") {
        s.campaign.status = "archived";
        s.completionArchiveUnknown = false;
      }
      return true;
    }
    if (name === "completion-confirm-archive") {
      if (
        !r.can("createCampaigns") ||
        blockedLocally() ||
        !s.completionDialog ||
        s.completionArchiveUnknown
      )
        return true;
      await load();
      r.guard();
      if (
        !s.completionDialog ||
        !r.can("createCampaigns") ||
        blockedLocally() ||
        !fresh() ||
        s.completion?.canArchive !== true ||
        s.completion.state !== "campaign_complete"
      ) {
        s.completionDialog = false;
        return true;
      }
      const campaignId = s.campaign.campaignId,
        version = generation;
      let saved = false;
      s.completionSubmitting = true;
      r.changed?.();
      try {
        const response = await r.api(
          `/campaigns/${id(campaignId)}/transition`,
          {
            expectedRevision: s.completion.campaignRevision,
            action: "archive",
            completionProofId: s.completion.proofId,
          },
        );
        if (!current(version, campaignId)) return true;
        if (
          response.campaign?.campaignId !== campaignId ||
          response.campaign.status !== "archived"
        )
          throw new Error("Closure could not be verified.");
        s.campaign = response.campaign;
        s.completionDialog = false;
        saved = true;
      } catch (error) {
        if (!current(version, campaignId)) return true;
        s.completionDialog = false;
        s.completionError = true;
        s.completionArchiveUnknown = true;
        if ([401, 403].includes(error?.status)) throw error;
      } finally {
        s.completionSubmitting = false;
      }
      if (saved) await load();
      return true;
    }
    return false;
  }
  function localAction(name, value) {
    if (!name.startsWith("completion-")) return false;
    const s = state();
    r.guard();
    if (
      name === "completion-scope" &&
      ["personal", "campaign"].includes(value)
    ) {
      s.completionScope = value;
      return true;
    }
    if (name === "completion-results") {
      s.completionScope = value === "campaign" ? "campaign" : "personal";
      s.completionResults = true;
      return true;
    }
    if (name === "completion-finish") {
      s.completionResults = false;
      if (r.context().section !== "send")
        r.navigate("send", s.campaign.campaignId);
      return true;
    }
    if (name === "completion-review") {
      s.completionResults = false;
      s.completionFinish = false;
      s.queueFolder = "to-send";
      if (r.context().section !== "send")
        r.navigate("send", s.campaign.campaignId);
      return true;
    }
    if (name === "completion-archive") {
      if (
        r.can("createCampaigns") &&
        s.completion?.canArchive === true &&
        fresh() &&
        !blockedLocally() &&
        !s.completionArchiveUnknown
      ) {
        s.completionDialog = true;
        focusConfirmation();
      }
      return true;
    }
    if (name === "completion-cancel-archive") {
      if (!s.completionSubmitting) s.completionDialog = false;
      return true;
    }
    return false;
  }
  return {
    load,
    action,
    localAction,
    finish,
    results,
    dispose() {
      disposed = true;
      generation++;
      clearTimeout(focusTimer);
      globalThis.document?.removeEventListener?.("keydown", onKey);
    },
  };
}
