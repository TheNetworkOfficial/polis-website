import {
  escapeText as e,
  list,
  button,
  go,
  head,
  notice,
  reasons,
  queueCanConfirm,
  queueCanSkip,
  queueCanRefreshPreview,
  queueBlockExplanation,
  checkedUrl,
  protectedMediaData,
  messagePrice,
  rateMoney,
  money,
  customerText,
} from "./textingWorkspaceUi";
import { textingFolderRoute } from "./textingFolders";

export const queueMediaReady = (s, item) =>
  s.imageLoaded === item?.itemId ||
  s.queueImagesLoaded?.has(item?.itemId) === true;

export const queuePendingAction = (s, itemId) =>
  s.pendingItems?.get(itemId) ||
  (s.pendingItemId === itemId ? s.pendingAction || "sending" : null);
export const queueHasPending = (s) =>
  Boolean(s.pendingItems?.size || s.pendingItemId);

/** Keep the exact final preview visible before each human's recipient-bound Send. */
export function renderTextingQueue(s, r, needsReview, outcomes) {
  const c = s.campaign,
    q = s.queue,
    items = list(q?.items);
  const attempted = (item) =>
    Boolean(queuePendingAction(s, item.itemId)) ||
    needsReview(s, item) ||
    item.state === "rejected_not_accepted";
  const ready = items.filter((item) => !attempted(item));
  const held = items.filter(attempted);
  const pendingRows = held.filter((item) => queuePendingAction(s, item.itemId));
  const ordered = [
    ...ready,
    ...pendingRows,
    ...held.filter((item) => !queuePendingAction(s, item.itemId)),
  ];
  const imageUrl = (item) =>
    item.stream === "opt_in" && item.preview?.mediaId
      ? protectedMediaData(s.queueMedia?.[item.preview.mediaId])
      : checkedUrl(item.preview?.attachmentUrl);
  const signature = (item) =>
    JSON.stringify([
      item.preview?.message,
      item.preview?.attachmentUrl || "",
      item.preview?.mediaId || "",
      item.stream || "",
    ]);
  const shared =
    ready.length > 0 &&
    ready.every((item) => signature(item) === signature(ready[0]));
  const preview = (item, sharedItems = [item]) => {
    const p = item.preview || {},
      image = imageUrl(item);
    return `<div class="pt-workspace-bubble pt-texting-final-message">${p.attachmentUrl || p.mediaId ? (image ? `<img data-workspace-queue-image="${e(item.itemId)}" data-workspace-queue-images="${e(sharedItems.map((row) => row.itemId).join(","))}" src="${e(image)}" alt="Final message attachment" referrerpolicy="no-referrer">` : notice("Attachment unavailable")) : ""}<p>${e(p.message || "Final text unavailable")}</p></div>`;
  };
  const row = (item) => {
    const p = item.preview || {},
      pending = queuePendingAction(s, item.itemId);
    const review = needsReview(s, item),
      block = queueBlockExplanation(item);
    const failed =
      item.state === "rejected_not_accepted" &&
      item.nonAcceptanceVerified === true;
    const expired =
      item.state === "awaiting_confirmation" && item.expiresAtMs <= Date.now();
    const price = messagePrice(
      r.billing(),
      p.message,
      !!(p.attachmentUrl || p.mediaId),
      item.stream,
    );
    const control = (action, text, options = {}) =>
      button(action, text, { value: item.itemId, ...options });
    const disabled = r.busy() || Boolean(pending);
    const mutationDisabled = disabled || queueHasPending(s);
    const recipient = p.contactDisplayName || p.contactPhone || "Recipient";
    const status = pending
      ? pending === "sending"
        ? "Sending…"
        : "Skipping…"
      : review
        ? "Needs review"
        : failed
          ? "Not sent"
          : block?.title || "";
    return `<article class="pt-texting-recipient${attempted(item) ? " pt-texting-recipient--held" : ""}" data-texting-recipient="${e(item.itemId)}"><div class="pt-texting-recipient-head"><div class="pt-texting-person"><strong>${e(recipient)}</strong>${p.contactDisplayName ? `<span class="pt-muted">${e(p.contactPhone)}</span>` : ""}${status ? `<span class="pt-tag">${e(status)}</span>` : ""}</div>${item.state === "lease_expired" || c.queueRecoveryRequired ? "" : control("queue-confirm", pending === "sending" ? "Sending…" : "Send", { disabled: disabled || review || !queueCanConfirm(item, r.workspace(), r.billing(), queueMediaReady(s, item)) }).replace("<button ", `<button aria-label="${e(`Send to ${recipient}`)}" `)}</div>${!shared || attempted(item) ? preview(item) : ""}${review && !pending && !item.sendError ? notice("Delivery needs review", "Do not send again. You can continue with other ready recipients.") : ""}${block && !review && !pending ? notice(block.title, block.text) + (block.canRecheck ? control("queue-recheck", "Check recipient again", { secondary: true, disabled: mutationDisabled || !r.can("manualQueue") || !c.canFetchQueue }) : "") : ""}${item.sendError && !pending ? `<div class="pt-notice" role="alert"><strong>${review ? "Delivery needs review" : "Not sent"}</strong><p>${e(item.sendError.message)}</p><small>Error code: ${e(customerText(item.sendError.code))}</small></div>` : ""}${reasons(item.blockedReasons)}${item.state === "lease_expired" ? notice("Recipient assignment expired", "This unsent recipient needs provider release before reassignment.") : expired ? notice("Preview expired", "Refresh these message previews, then review them before sending.") + (queueCanRefreshPreview(item) && !review && !pending ? control("queue-refresh-preview", "Refresh message previews", { secondary: true, disabled: mutationDisabled }) : "") : ""}${failed && !item.sendError ? notice("Message was not accepted", "No resend was authorized. This recipient remains visible for review.") : ""}<div class="pt-texting-row-tools">${r.can("manageBilling") && price !== null ? `<span class="pt-muted">${p.attachmentUrl || p.mediaId ? "MMS" : "SMS"} · ${rateMoney(price)}</span>` : ""}${!pending && !review && queueCanSkip(item) ? control("queue-skip", "Skip recipient", { secondary: true, disabled: mutationDisabled || !r.can("manualQueue") || !c.canFetchQueue }) : ""}${review && !pending && item.state === "awaiting_confirmation" && r.can("queueItemRecovery") ? control("queue-recover-preview", "Check unsent preview", { secondary: true, disabled: mutationDisabled }) : ""}${failed && item.stream === "opt_in" && r.can("optionalRetryPreview") ? control("queue-retry-preview", "Prepare another attempt", { secondary: true, disabled: mutationDisabled }) : ""}${failed ? control("queue-next", "Continue to next recipient", { secondary: true, disabled: mutationDisabled }) : ""}${outcomes?.trigger({ campaignId: c.campaignId, itemId: item.itemId }) || ""}</div></article>`;
  };
  const sentItems = [...(s.sentItems?.values() || [])];
  const sentFolder = s.queueFolder === "sent";
  const tabs = `<nav class="pt-texting-folders" aria-label="Campaign messages">${button("queue-folder", `To send${items.length ? ` (${items.length})` : ""}`, { value: "to-send", secondary: sentFolder }).replace("<button ", `<button${!sentFolder ? ' aria-current="page"' : ""} `)}${button("queue-folder", `Sent${sentItems.length ? ` (${sentItems.length})` : ""}`, { value: "sent", secondary: !sentFolder }).replace("<button ", `<button${sentFolder ? ' aria-current="page"' : ""} `)}${go("inbox", "Replies", textingFolderRoute("replies", c.campaignId), true)}${go("inbox", "All messages", textingFolderRoute("all", c.campaignId), true)}</nav>`;
  if (sentFolder)
    return (
      head(
        c.name,
        "Messages",
        "One press sends to one person.",
        button("queue-leave", "Leave session", {
          value: c.campaignId,
          secondary: true,
        }),
      ) +
      tabs +
      `<section class="pt-card"><h2>Sent</h2><p class="pt-muted">Accepted in this session. Delivery is tracked separately.</p>${
        sentItems.length
          ? sentItems
              .slice(0, s.sentVisible || 20)
              .map(
                (item) =>
                  `<article class="pt-texting-recipient" data-texting-sent="${e(item.itemId)}"><div class="pt-texting-person"><strong>${e(item.preview?.contactDisplayName || item.preview?.contactPhone || "Recipient")}</strong><span class="pt-tag">Accepted</span></div>${preview(item)}</article>`,
              )
              .join("")
          : `<p class="pt-muted">No accepted sends in this session yet.</p>`
      }${sentItems.length > (s.sentVisible || 20) ? button("queue-sent-more", "Show more", { secondary: true }) : ""}${r.can("readReporting") ? go("results", "View campaign history", c.campaignId, true) : ""}</section>`
    );
  const moreAllowed =
    !items.some((item) => !attempted(item)) && !s.pendingItemId;
  return (
    head(
      c.name,
      "Messages",
      "One press sends to one person.",
      button("queue-leave", "Leave session", {
        value: c.campaignId,
        secondary: true,
      }),
    ) +
    tabs +
    `<div class="pt-texting-session-status" role="status">${e(queueHasPending(s) ? `${s.pendingItems?.size || 1} sending…` : r.view().message || `${s.sent || 0} accepted this session`)}${r.can("manageBilling") ? `<span>Available funds: ${money(r.billing()?.availableMicros)}</span>` : ""}</div>` +
    (!c.canFetchQueue ||
    r.workspace()?.canSend !== true ||
    r.billing()?.sendingBlocked !== false
      ? button("queue-refresh-status", "Refresh sending status", {
          secondary: true,
          disabled: r.busy(),
        })
      : "") +
    (c.queueRecoveryRequired
      ? notice(
          "Sending is paused",
          "Review and skip held recipients. No messages will be sent.",
        )
      : "") +
    (shared
      ? `<section class="pt-card"><div class="pt-eyebrow">FINAL MESSAGE</div>${preview(ready[0], ready)}</section>`
      : "") +
    (ordered.length
      ? `<section class="pt-card pt-texting-queue" aria-label="Assigned recipients">${ordered.map(row).join("")}</section>`
      : `<section class="pt-card"><h2>${!q ? "Your next recipients" : q.state === "preparing" ? "Preparing held recipients" : q.state === "allocation_unknown" ? "Session needs review" : q.state === "lease_expired" ? "Recipient assignment expired" : c.queueRecoveryRequired ? "Held recipients reviewed" : "You’re caught up"}</h2><p class="pt-muted">${q?.state === "allocation_unknown" ? "Your assigned messages could not be confirmed. Ask an administrator to check the saved status." : q?.state === "preparing" ? "Your saved assignment is being checked. Check again to continue." : "Get a group of assigned recipients, then send each message individually."}</p></section>`) +
    (held.length && r.can("queueStatus")
      ? button("queue-status", "Check saved recipient outcomes", {
          secondary: true,
          disabled: r.busy() || Boolean(s.pendingItemId),
        })
      : "") +
    (s.lastOutcomeTarget?.campaignId === c.campaignId
      ? outcomes?.trigger(
          s.lastOutcomeTarget,
          "Record previous recipient outcome",
        ) || ""
      : "") +
    (moreAllowed &&
    q?.state !== "allocation_unknown" &&
    (!c.queueRecoveryRequired || !q || q.state === "preparing")
      ? `<div class="pt-texting-next">${button("queue-load", s.preparingAccess ? "Preparing your texting access…" : q?.state === "preparing" ? "Check recipients" : c.queueRecoveryRequired ? "Review held recipients" : "Get next recipients", { disabled: !c.canFetchQueue || !r.can("manualQueue") || r.busy() })}</div>`
      : "") +
    reasons(q?.blockedReasons || c.blockedReasons)
  );
}
