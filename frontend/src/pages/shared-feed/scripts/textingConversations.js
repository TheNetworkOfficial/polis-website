import {
  escapeText as e,
  label,
  money,
  id,
  list,
  button,
  go,
  head,
  textarea,
  notice,
  checkedUrl,
  uuid,
  messagePrice,
  messageFundingReady,
} from "./textingWorkspaceUi";
import { prepareTextingAccess } from "./textingAccess";

const when = (value) =>
  Number.isSafeInteger(value) ? new Date(value).toLocaleString() : "";
export function createConversations(r) {
  const state = () => (r.view().conversations ||= {});
  let pollTimer,
    pollReads = 0,
    pollDeadline = 0,
    pendingReply,
    disposed = false,
    refreshing = false;
  function dispose() {
    disposed = true;
    clearTimeout(pollTimer);
  }
  async function read(resource, { append = false } = {}) {
    const s = state();
    if (resource) {
      const result = await r.api(
        `/conversations/${id(resource)}${append && s.cursor ? `?cursor=${id(s.cursor)}` : ""}`,
      );
      if (disposed) return;
      r.guard();
      if (result.conversation?.conversationId !== resource)
        throw new Error("Conversation could not be verified.");
      s.conversation = result.conversation;
      s.messages = [
        ...(append ? s.messages || [] : []),
        ...list(result.messages),
      ];
      s.cursor = result.nextCursor;
      if (
        pendingReply &&
        s.messages.some(
          (message) =>
            message.direction === "outbound" &&
            message.content === pendingReply.content &&
            message.messageId != null &&
            !pendingReply.messageIds.has(String(message.messageId)) &&
            ["DELIVERED", "FAILED", "UNDELIVERED", "REJECTED"].includes(
              String(message.status).toUpperCase(),
            ),
        )
      )
        pendingReply = null;
    } else {
      const result = await r.api(
        `/conversations${append && s.cursor ? `?cursor=${id(s.cursor)}` : ""}`,
      );
      if (disposed) return;
      r.guard();
      s.items = [...(append ? s.items || [] : []), ...list(result.items)];
      s.cursor = result.nextCursor;
    }
  }
  /** Poll saved messages only; a delayed callback never repeats a reply POST. */
  function scheduleUpdate(resource) {
    clearTimeout(pollTimer);
    const remaining = pollDeadline - Date.now();
    if (
      disposed ||
      !pendingReply ||
      !resource ||
      pollReads >= 6 ||
      remaining <= 0
    )
      return;
    pollTimer = setTimeout(
      async () => {
        if (disposed || document.hidden || Date.now() > pollDeadline) return;
        try {
          r.guard();
        } catch {
          dispose();
          return;
        }
        if (r.busy()) {
          scheduleUpdate(resource);
          return;
        }
        pollReads++;
        await refresh(resource);
      },
      Math.min(10000, remaining),
    );
  }
  async function load(resource, options = {}) {
    await read(resource, options);
  }
  async function refresh(resource) {
    if (refreshing || disposed || !resource) return;
    refreshing = true;
    try {
      r.guard();
      if (state().sendStatusNeedsRead) {
        await r.refreshSendStatus();
        if (disposed) return;
        state().sendStatusNeedsRead = false;
      }
      await read(resource);
      if (!disposed) state().refreshError = false;
    } catch (error) {
      try {
        r.guard();
      } catch {
        dispose();
        return;
      }
      if (disposed) return;
      if (error?.status === 401 || error?.status === 403) {
        dispose();
        r.fail(error);
        r.changed();
        return;
      }
      // A read failure does not change an already accepted send outcome.
      state().refreshError = true;
    } finally {
      refreshing = false;
      if (!disposed) {
        scheduleUpdate(resource);
        r.changed();
      }
    }
  }
  function render() {
    const s = state(),
      c = s.conversation;
    if (!r.context().resourceId)
      return (
        head(
          "INBOX",
          "Keep the conversation going",
          "Replies and delivery updates appear here.",
          button("conversations-refresh", "Refresh", { secondary: true }),
        ) +
        `<section class="pt-card">${list(s.items).length ? s.items.map((row) => `<div class="pt-row"><div><strong>${e(row.displayName || row.phone)}</strong><p class="pt-muted">${e(when(row.lastMessageAtMs))} · ${row.suppressed ? "Opted out" : e(label(row.status))}</p></div>${go("conversation", "Open", row.conversationId, true)}</div>`).join("") : `<h2>No conversations yet</h2><p class="pt-muted">Messages appear after verified sending and reply notifications.</p>`}${s.cursor ? button("conversations-more", "Load more", { secondary: true }) : ""}</section>`
      );
    if (!c) return "";
    const hold = r.sendHeld(`reply:${c.conversationId}`),
      price = messagePrice(r.billing(), s.reply || ""),
      canReply =
        r.workspace()?.canSend === true &&
        c.canReply === true &&
        !c.suppressed &&
        !hold &&
        messageFundingReady(r.workspace(), r.billing(), s.reply || "");
    return (
      head(
        "CONVERSATION",
        c.displayName || c.phone,
        c.displayName ? c.phone : "",
        go("inbox", "All conversations", "", true),
      ) +
      `${s.preparingAccess ? notice("Preparing your texting access…") : ""}${s.refreshError ? notice("Updates are delayed", "Refresh to check the saved messages. Do not resend an accepted reply.") : ""}<div class="pt-grid pt-grid--two"><section class="pt-card"><div class="pt-row"><span class="pt-tag">${c.suppressed ? "Opted out" : e(label(c.status))}</span>${button("conversations-refresh", "Refresh", { secondary: true })}</div><div class="pt-workspace-thread">${
        list(s.messages)
          .map(
            (message) =>
              `<article class="pt-workspace-message ${message.direction === "outbound" ? "pt-workspace-message--out" : ""}"><div class="pt-workspace-bubble">${list(
                message.media,
              )
                .map((media) =>
                  checkedUrl(media.url)
                    ? `<img src="${e(checkedUrl(media.url))}" alt="${e(media.name || "Message attachment")}" referrerpolicy="no-referrer" loading="lazy">`
                    : `<p>Attachment unavailable</p>`,
                )
                .join(
                  "",
                )}<p>${e(message.content)}</p></div><small class="pt-muted">${message.direction === "outbound" ? "Sent" : "Received"} · ${e(when(message.createdAtMs))} · ${e(label(message.status))}</small></article>`,
          )
          .join("") || `<p class="pt-muted">No recorded messages yet.</p>`
      }</div>${s.cursor ? button("conversations-more", "More messages", { secondary: true }) : ""}${c.suppressed ? notice("This person opted out", "Sending is blocked for this recipient.") : hold || c.replyState === "provider_outcome_unknown" ? notice("Reply needs review", "Do not resend. The saved outcome must be confirmed first.") : `<form data-workspace-form="reply">${textarea("reply", "Reply", s.reply || "", true)}<div class="pt-row"><span class="pt-muted">Text reply${r.can("manageBilling") ? ` · ${price === null ? "Rate unavailable" : money(price)}` : ""}</span><button class="pt-btn" type="submit"${!canReply || r.busy() ? " disabled" : ""}>Send reply</button></div>${!c.canReply ? `<p class="pt-muted">Replies are paused until this conversation is eligible for a response.</p>` : ""}</form>`}</section><aside class="pt-card"><h2>Contact details</h2><div class="pt-row"><span>Phone</span><strong>${e(c.phone)}</strong></div><div class="pt-row"><span>Texting status</span><strong>${c.suppressed ? "Opted out" : "No opt-out recorded"}</strong></div><p class="pt-muted">A reply does not establish written opt-in.</p>${c.canSuppress && !c.suppressed ? button("conversation-suppress", "Record opt-out", { secondary: true, disabled: r.busy() }) : ""}${c.suppressed && c.providerSyncState ? `<p class="pt-muted">Vendor opt-out: ${e(label(c.providerSyncState))}</p>` : ""}${c.canSyncSuppression ? button("conversation-sync", "Check vendor opt-out", { secondary: true, disabled: r.busy() }) : ""}${go("campaigns", "View campaign", c.campaignId, true)}</aside></div>`
    );
  }
  async function submit(kind, form) {
    if (kind !== "reply") return false;
    const s = state(),
      c = s.conversation,
      key = `reply:${c.conversationId}`,
      content = String(new FormData(form).get("reply") || "").trim();
    if (
      !content ||
      content.length > 1600 ||
      !c.canReply ||
      c.suppressed ||
      r.sendHeld(key) ||
      !r.workspace()?.canSend ||
      !messageFundingReady(r.workspace(), r.billing(), content)
    )
      throw new Error(
        "This reply is not eligible to send. Check the saved status.",
      );
    await prepareTextingAccess(r, s, c.campaignId);
    const actionId = uuid(),
      messageIds = new Set(
        list(s.messages).map((message) => String(message.messageId)),
      );
    r.holdSend(key);
    const result = (
      await r.api(`/conversations/${id(c.conversationId)}/reply`, {
        actionId,
        content,
      })
    ).result;
    if (result?.actionId !== actionId)
      throw new Error("The reply outcome could not be verified.");
    if (result.state === "accepted") {
      r.releaseSend(key);
      s.reply = "";
      pendingReply = { content, messageIds };
      pollReads = 0;
      pollDeadline = Date.now() + 60000;
      r.toast("Reply accepted. Delivery updates will appear here.");
    } else r.toast("Reply outcome needs review. Do not resend.");
    s.sendStatusNeedsRead = true;
    await refresh(c.conversationId);
    return true;
  }
  async function action(name) {
    const s = state(),
      c = s.conversation;
    if (name === "conversations-refresh" || name === "conversations-more") {
      if (name === "conversations-refresh" && r.context().resourceId) {
        s.sendStatusNeedsRead = true;
        await refresh(r.context().resourceId);
      } else {
        await load(r.context().resourceId, { append: name.endsWith("-more") });
      }
      return true;
    }
    if (name === "conversation-suppress") {
      if (!c.canSuppress || c.suppressed)
        throw new Error("Opt-out controls are unavailable.");
      if (
        !window.confirm(
          `Record an opt-out for ${c.phone}? This blocks future messages from this organization.`,
        )
      )
        return true;
      s.suppressAction ||= uuid();
      const result = (
        await r.api(`/conversations/${id(c.conversationId)}/suppress`, {
          actionId: s.suppressAction,
          reason:
            "Recipient requested an opt-out; recorded by an authorized texter.",
        })
      ).result;
      if (result?.suppressed !== true)
        throw new Error(
          "Refresh this conversation to check its opt-out status.",
        );
      await load(c.conversationId);
      r.toast("Opt-out recorded");
      return true;
    }
    if (name === "conversation-sync") {
      if (!c.canSyncSuppression)
        throw new Error("Refresh opt-out status first.");
      await r.api(
        `/conversations/${id(c.conversationId)}/suppression-sync`,
        {},
      );
      await load(c.conversationId);
      return true;
    }
    return false;
  }
  function change(target) {
    if (target.name === "reply") {
      state().reply = target.value;
      return true;
    }
    return false;
  }
  return { load, render, submit, action, change, refresh, dispose };
}
