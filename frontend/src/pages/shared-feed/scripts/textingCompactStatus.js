import {
  escapeText as e,
  label,
  button,
  go,
  list,
  money,
  count,
} from "./textingWorkspaceUi";

/** Presentation only. Acknowledgement never changes a campaign, assignment or
 * send fence. Every offered operation still uses its existing authorized action. */
export function createTextingCompactStatus(r, state) {
  let panel = "",
    acknowledged = "",
    focusAction = "compact-details",
    focusValue = "",
    focusedPanel = "";
  const icon = (name) => {
    const paths = {
      back: "M15 18l-6-6 6-6",
      more: "M12 5h.01M12 12h.01M12 19h.01",
      clock: "M12 8v4l3 2",
      close: "M6 6l12 12M18 6L6 18",
      check: "M5 12l4 4L19 6",
      assignment: "M8 5H5v16h14V5h-3M8 3h8v4H8zM8 12h8M8 16h5",
      refresh:
        "M20 7v5h-5M4 17v-5h5M5.6 7a7 7 0 0111.7-2L20 8M4 16l2.7 3A7 7 0 0018.4 17",
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${name === "clock" ? '<circle cx="12" cy="12" r="9"/>' : ""}<path d="${paths[name] || paths.assignment}"/></svg>`;
  };
  const control = (action, text, extra = "") =>
    `<button type="button" class="pt-compact-icon" data-workspace-action="${action}" aria-label="${e(text)}" ${extra}>${icon(action === "compact-more" ? "more" : action === "compact-activity" ? "clock" : "close")}</button>`;
  function model() {
    const s = state(),
      c = s.campaign,
      v = r.view(),
      w = r.workspace(),
      billing = r.billing();
    const renewals = r.can("manageBilling")
      ? list(w?.renewalDeadlines || billing?.renewalDeadlines).filter(
          (entry) =>
            entry.status !== "current" &&
            Number.isSafeInteger(entry.expiresAtMs) &&
            entry.expiresAtMs > 0 &&
            entry.expiresAtMs <= 8640000000000000,
        )
      : [];
    const issues = [];
    let kind = "ready",
      text =
        c?.status === "paused"
          ? "Campaign paused"
          : c?.status === "archived"
            ? "Campaign archived"
            : c?.status === "activating"
              ? "Campaign is opening"
              : c?.status === "draft"
                ? "Ready for preparation"
                : "Ready to start",
      chip = label(c?.status || "Ready").replace(/^./, (letter) =>
        letter.toUpperCase(),
      ),
      action = "",
      description = "The latest saved campaign is loaded.";
    if (s.queueRequestNeedsRead || s.queue?.state === "allocation_unknown") {
      const previous = s.queuePreviousCampaign;
      kind = previous ? "previous" : "uncertain";
      text = previous ? "Previous assignment" : "Recipient request paused";
      chip = previous ? "Review" : "Unconfirmed";
      description =
        s.queueRequestMessage ||
        "The result of your recipient request is not confirmed. Check its saved status before requesting another batch.";
      action = previous
        ? go("send", "Open previous campaign", previous.campaignId)
        : r.can("queueStatus")
          ? button("queue-check-request", "Check saved status", {
              disabled: r.busy(),
            })
          : "";
      issues.push(description);
    } else if (
      !s.campaignStatusNeedsRead &&
      (s.queue?.state === "preparing" ||
        s.preparingRecipients ||
        c?.status === "activating")
    ) {
      kind = "processing";
      text =
        s.queue?.state === "preparing"
          ? "Preparing saved recipients…"
          : c?.status === "activating"
            ? "Campaign is opening…"
            : "Preparing campaign…";
      chip = "Checking";
      description =
        "Your saved work is being prepared. Check its current status before continuing.";
      action = button(
        s.queue?.state === "preparing" ? "queue-load" : "campaign-refresh",
        s.queue?.state === "preparing"
          ? "Check recipients"
          : "Check preparation",
        {
          disabled:
            r.busy() ||
            (s.queue?.state === "preparing" &&
              (!c.canFetchQueue || !r.can("manualQueue"))),
        },
      );
    } else if (s.campaignStatusNeedsRead) {
      kind = "refresh";
      text = "Check saved campaign";
      chip = "Review";
      description =
        "Refresh the saved campaign before taking another action. Your work stays saved.";
      action = button("campaign-status-refresh", "Refresh campaign status", {
        disabled: r.busy(),
      });
      issues.push(description);
    }
    if (v.error) issues.push(v.error);
    if (w?.canSend !== true || billing?.sendingBlocked !== false)
      issues.push(
        "Sending is paused. Review the current sending requirements.",
      );
    if (w?.setup?.manualReviewRequired && w.setup.state !== "ready")
      issues.push(w.setup.nextStep || "Texting setup needs review.");
    if (c?.queueRecoveryRequired && list(s.queue?.items).length)
      issues.push("Review and skip held recipients before continuing.");
    const heldItems = list(s.queue?.items).filter(
      (item) =>
        !s.pendingItems?.has(item.itemId) &&
        s.pendingItemId !== item.itemId &&
        ([
          "provider_outcome_unknown",
          "blocked",
          "rejected_not_accepted",
          "lease_expired",
          "route_refresh_required",
        ].includes(item.state) ||
          r.sendHeld?.(`queue:${c?.campaignId}:${item.itemId}`)),
    );
    if (heldItems.length)
      issues.push(
        `${heldItems.length} saved recipient${heldItems.length === 1 ? " needs" : "s need"} review. Other ready recipients can continue.`,
      );
    if (billing?.lowBalance === true)
      issues.push(
        "Texting funds are running low. Review the balance before continuing.",
      );
    if (billing?.billingHold)
      issues.push("Sending remains paused while the billing hold is reviewed.");
    const rates = [
      billing?.smsUpToTwoSegmentsMicros,
      billing?.mmsMicros,
    ].filter((rate) => Number.isSafeInteger(rate) && rate > 0);
    const emptyBalance =
      billing?.availableMicros === 0 ||
      billing?.unfundedMicros > 0 ||
      (rates.length > 0 &&
        rates.every((rate) => billing.availableMicros < rate));
    if (emptyBalance)
      issues.push("Texting funds need attention before sending.");
    if (w?.sendingMode === "pilot" && w.pilot)
      issues.push(
        `Controlled test: ${count(w.pilot.remainingMessages)} messages${r.can("manageBilling") ? ` and ${money(w.pilot.remainingSpendMicros)}` : ""} remain. Only approved test recipients can be contacted.`,
      );
    const infoKey = JSON.stringify([
      r.context?.().organizationId,
      r.context?.().userId,
      c?.campaignId,
      c?.revision,
      s.campaignStatusMessage,
      s.queueRequestMessage,
      v.message,
    ]);
    const info =
      acknowledged !== infoKey &&
      (s.campaignStatusMessage || s.queueRequestMessage || v.message);
    if (kind === "ready" && (issues.length || renewals.length)) {
      kind = "attention";
      chip = "Review";
      text = v.error
        ? "An action needs attention"
        : renewals.length
          ? "Texting review due"
          : heldItems.length
            ? "Some recipients need review"
            : "Sending requirements";
    } else if (kind === "ready" && info) text = "Campaign status updated";
    if (r.busy() && (s.campaignStatusNeedsRead || s.queueRequestNeedsRead)) {
      kind = "checking";
      chip = "Checking";
      text = "Checking saved status…";
    }
    if (!action && kind === "attention") {
      if (heldItems.length)
        action = button("compact-panel", "Review assigned recipients", {
          value: "recipients",
          secondary: true,
        });
      else if (
        r.can("manageBilling") &&
        (emptyBalance || billing?.billingHold || billing?.lowBalance)
      )
        action = go("balance", "View texting balance", "", true);
      else if (w?.canSend !== true || billing?.sendingBlocked !== false)
        action = button("queue-refresh-status", "Refresh sending status", {
          secondary: true,
          disabled: r.busy(),
        });
    }
    return {
      kind,
      text,
      chip,
      action,
      description,
      issues,
      renewals,
      info,
      infoKey,
      count:
        issues.length +
        renewals.length -
        (v.error &&
        ["previous", "uncertain", "refresh", "checking"].includes(kind)
          ? 1
          : 0),
    };
  }
  function syncFocus() {
    if (typeof document === "undefined" || !document.querySelector) return;
    queueMicrotask(() => {
      const root = document.querySelector("[data-texting-compact]");
      if (!root) return;
      if (
        panel &&
        (focusedPanel !== panel ||
          !root
            .querySelector("[data-contact-dialog=compact]")
            ?.contains(document.activeElement))
      ) {
        root.querySelector("#pt-compact-title")?.focus({ preventScroll: true });
        focusedPanel = panel;
      } else if (!panel && focusedPanel) {
        const target = [
          ...root.querySelectorAll("[data-workspace-action]"),
        ].find(
          (node) =>
            node.dataset.workspaceAction === focusAction &&
            (node.dataset.value || "") === focusValue,
        );
        (
          target ||
          root.querySelector('[data-workspace-action="compact-more"]') ||
          root.querySelector(".pt-compact-action-zone button")
        )?.focus({ preventScroll: true });
        focusedPanel = "";
      }
    });
  }
  function render({
    body,
    primary,
    caption,
    more = "",
    details = "",
    activity = "",
    recipients = "",
    section = "send",
  }) {
    const s = state(),
      c = s.campaign,
      m = model(),
      open = Boolean(panel),
      warning = !["ready", "checking", "processing"].includes(m.kind),
      symbol = ["checking", "processing"].includes(m.kind)
        ? "refresh"
        : warning
          ? "assignment"
          : "check";
    const showDetails = () =>
      `<p>${e(m.description)}</p>${s.queuePreviousCampaign ? `<div class="pt-compact-assignment"><strong>${e(s.queuePreviousCampaign.name)}</strong><span>Saved assignment · yours to review</span></div>` : ""}${m.issues
        .filter((text) => text !== m.description)
        .map((text) => `<p>${e(text)}</p>`)
        .join(
          "",
        )}${m.renewals.map((entry) => `<div class="pt-compact-assignment"><strong>${e(entry.label || "Texting review")} ${entry.status === "expired" ? "needs renewal" : "is due soon"}</strong><span>${e(new Date(entry.expiresAtMs).toLocaleDateString())} · ${e(entry.owner || "Polis support")}</span><p>${e(entry.nextStep || "Ask Polis support to review this approval before it expires.")}</p></div>`).join("")}${m.kind === "uncertain" ? "<p>Ask your organization’s texting manager to review this saved request if it remains unconfirmed. Your message and history stay saved.</p>" : ""}${r.can("manageBilling") ? `<div class="pt-compact-assignment"><strong>Available funds: ${money(r.billing()?.availableMicros)}</strong>${go("balance", "View texting balance", "", true)}</div>` : ""}${m.action || (m.info ? `<p>${e(m.info)}</p>${button("compact-ack", "Got it")}` : button("compact-overlay-close", "Done", { secondary: true }))}`;
    const title =
      panel === "more"
        ? "Campaign options"
        : panel === "activity"
          ? "Recent activity"
          : panel === "pause"
            ? "Pause this campaign?"
            : panel === "campaign"
              ? "Campaign details"
              : panel === "recipients"
                ? "Assigned recipients"
                : m.kind === "previous"
                  ? "Finish your assignment"
                  : m.kind === "uncertain"
                    ? "Check the saved request"
                    : ["checking", "processing"].includes(m.kind)
                      ? "Checking saved status"
                      : warning
                        ? "Review campaign status"
                        : "Campaign is up to date";
    const panelBody =
      panel === "more"
        ? `<div class="pt-compact-menu">${button("compact-panel", "Campaign details", { value: "campaign", secondary: true })}${r.can("createCampaigns") ? go("team", "Manage team", c.campaignId, true) : ""}${recipients ? button("compact-panel", "Assigned recipients", { value: "recipients", secondary: true }) : ""}${more}${r.can("manageBilling") ? go("balance", "Texting balance", "", true) : ""}${section === "send" ? button("queue-leave", "Leave session", { value: c.campaignId, secondary: true }) : ""}</div>`
        : panel === "pause"
          ? `<p>Your campaign and message history stay saved. You can resume when you’re ready.</p>${button("transition-pause", "Pause campaign", { disabled: r.busy() || s.campaignStatusNeedsRead || !r.can("createCampaigns") || c.status !== "active" })}${button("compact-overlay-close", "Keep campaign active", { secondary: true })}`
          : panel === "campaign"
            ? details
            : panel === "recipients"
              ? recipients
              : panel === "activity"
                ? `<p>Latest saved status and campaign history.</p>${[
                    s.campaignStatusMessage,
                    s.queueRequestMessage,
                    r.view().message,
                  ]
                    .filter(Boolean)
                    .map((text) => `<p>${e(text)}</p>`)
                    .join(
                      "",
                    )}${activity || "<p>No recent status updates in this view.</p>"}`
                : showDetails();
    syncFocus();
    return `<section class="pt-compact-texting" data-texting-compact="${e(c.campaignId)}"><div class="pt-compact-main" ${open ? "inert" : ""}><div class="pt-compact-toolbar">${`<button type="button" class="pt-compact-back" data-workspace-action="${section === "send" ? "queue-leave" : "navigate"}" data-value="${e(section === "send" ? c.campaignId : JSON.stringify(["campaigns", ""]))}">${icon("back")}<span>Back to campaigns</span></button>`}<span>Text banking</span>${control("compact-activity", "Recent activity")}${control("compact-more", "Campaign options")}</div><header class="pt-compact-head"><div class="pt-compact-title"><h1>${e(c.name || "Campaign")}</h1><button type="button" class="pt-compact-status-chip${warning ? " is-attention" : ""}${["checking", "processing"].includes(m.kind) ? " is-checking" : ""}" data-workspace-action="compact-details" aria-label="${e(m.chip)}: open status details">${icon(symbol)}${e(m.chip)}${warning && m.count > 1 ? ` · ${m.count}` : ""}</button></div><div class="pt-compact-context" role="status" aria-live="polite"><span>${icon(symbol)}${e(m.text)}</span>${m.info && !warning && !["checking", "processing"].includes(m.kind) ? button("compact-ack", "Got it", { secondary: true }) : button("compact-details", "Details", { secondary: true })}</div></header><div class="pt-compact-content">${body}</div><div class="pt-compact-action-zone">${m.kind === "processing" ? m.action : m.kind === "previous" ? button("compact-details", "Review assignment") : m.kind === "uncertain" ? button("queue-check-request", "Check saved status", { disabled: r.busy() || !r.can("queueStatus") }) : m.kind === "refresh" || m.kind === "checking" ? button("campaign-status-refresh", m.kind === "checking" ? "Checking status…" : "Refresh campaign status", { disabled: r.busy() }) : primary}<p>${e(m.kind === "previous" ? "Your current assignment stays saved." : m.kind === "uncertain" ? "Sending stays paused until this request is resolved." : ["checking", "processing"].includes(m.kind) ? "Your saved work stays in place." : caption || (warning ? "Your campaign and history stay saved." : "Review your recipients before sending."))}</p></div></div>${open ? `<div class="pt-compact-scrim" data-workspace-action="compact-overlay-close"><section class="pt-compact-sheet" role="dialog" aria-modal="true" aria-labelledby="pt-compact-title" data-contact-dialog="compact" data-workspace-action="compact-noop" tabindex="-1"><div class="pt-compact-grip"></div><div class="pt-compact-sheet-head"><div class="pt-compact-sheet-symbol">${icon(symbol)}</div><div><h2 id="pt-compact-title" tabindex="-1">${e(title)}</h2><small>${panel === "details" && warning ? "One thing needs your attention" : e(c.name)}</small></div>${control("compact-overlay-close", "Close details")}</div><div class="pt-compact-sheet-body">${panelBody}</div>${panel === "details" && warning ? button("compact-overlay-close", "Stay on this campaign", { secondary: true }) : ""}</section></div>` : ""}</section>`;
  }
  function localAction(name, value, target) {
    if (
      name === "queue-outcome-open" ||
      (name === "transition-pause" && panel === "pause")
    )
      panel = "";
    if (!name.startsWith("compact-")) return false;
    if (name === "compact-overlay-close") panel = "";
    else if (name === "compact-ack") {
      acknowledged = model().infoKey;
      panel = "";
    } else if (
      [
        "compact-details",
        "compact-more",
        "compact-activity",
        "compact-panel",
      ].includes(name)
    ) {
      if (!panel) {
        focusAction = target?.dataset?.workspaceAction || name;
        focusValue = target?.dataset?.value || "";
      }
      panel = name === "compact-panel" ? value : name.slice(8);
    }
    return true;
  }
  return {
    render,
    localAction,
    model,
    dispose() {
      panel = "";
    },
  };
}
