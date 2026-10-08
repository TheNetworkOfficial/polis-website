import {
  escapeText as e,
  label,
  rateMoney,
  id,
  list,
  button,
  go,
  head,
  textarea,
  notice,
  checkedUrl,
  protectedMediaData,
  uuid,
  messagePrice,
  streamLabel,
  messageFundingReady,
} from "./textingWorkspaceUi";
import { prepareTextingAccess } from "./textingAccess";
import { createRecipientOutcomes } from "./textingRecipientOutcomes";
import { mergeConversationMessages } from "./textingConversationHistory";
import { textingReadRequest } from "./textingReadRequest";
import { createConversationReads } from "./textingConversationReads";
import { textingRequestWasNotDispatched } from "./textingSession";

const when = (value) =>
  Number.isSafeInteger(value) ? new Date(value).toLocaleString() : "";
export function createConversations(
  r,
  {
    schedule = setTimeout,
    cancel = clearTimeout,
    now = Date.now,
    visible = () => globalThis.document?.hidden !== true,
    maxPollReads = Infinity,
    maxPollDurationMs = Infinity,
    readTimeoutMs = 20000,
  } = {},
) {
  const outcomes = createRecipientOutcomes(r, "conversation-outcome");
  const state = () => (r.view().conversations ||= {});
  let pollTimer,
    pollReads = 0,
    pollDeadline = 0,
    pollFailures = 0,
    fastUntil = 0,
    resourceId,
    started = false,
    pendingReply,
    readFlight,
    readAbort,
    recoveryAbort,
    disposed = false,
    refreshing = false;
  let visibilityVersion = 0;
  const readApi = (path, signal) =>
    textingReadRequest(
      (requestSignal) =>
        r.api(path, undefined, undefined, { signal: requestSignal }),
      { signal, timeoutMs: readTimeoutMs },
    );
  const active = () => {
    if (disposed) return false;
    try {
      r.guard();
      return true;
    } catch {
      return false;
    }
  };
  const receipts = createConversationReads(r, {
    active,
    resource: () => resourceId,
    read: (path, signal) => readApi(path, signal),
    now,
  });
  const holdAction = (resource) => {
    const saved = r.sendHold?.(`reply:${resource}`) || state().replyAction;
    return saved?.conversationId === resource &&
      /^[A-Za-z0-9_-]{1,100}$/.test(saved.actionId || "")
      ? saved
      : null;
  };
  const generationRequired = () =>
    r.workspace()?.capabilities?.replyGenerationFencing === true;
  const generationReady = (conversation, floor) =>
    (!generationRequired() ||
      (Number.isSafeInteger(conversation?.replyGeneration) &&
        conversation.replyGeneration >= 0)) &&
    (!Number.isSafeInteger(floor) || conversation?.replyGeneration >= floor);
  function dispose() {
    disposed = true;
    cancel(pollTimer);
    readAbort?.abort();
    recoveryAbort?.abort();
    receipts.dispose();
    globalThis.document?.removeEventListener?.(
      "visibilitychange",
      visibilityChanged,
    );
    globalThis.window?.removeEventListener?.("focus", visibilityChanged);
    outcomes.dispose();
  }
  function renewPolling() {
    pollReads = 0;
    pollFailures = 0;
    pollDeadline = now() + maxPollDurationMs;
    state().updatesPaused = false;
  }
  function visibilityChanged() {
    if (!active() || !started) return;
    if (!visible()) {
      visibilityVersion++;
      cancel(pollTimer);
      readAbort?.abort();
      recoveryAbort?.abort();
    } else {
      renewPolling();
      // An aborted in-flight read drains before the resumed timer runs.
      if (refreshing) scheduleUpdate();
      else void refresh(resourceId);
    }
  }
  globalThis.document?.addEventListener?.(
    "visibilitychange",
    visibilityChanged,
  );
  globalThis.window?.addEventListener?.("focus", visibilityChanged);

  /** Reads an exact actor-bound action; generic eligibility never releases a hold. */
  async function reconcileReply(resource) {
    if (!resource || !visible() || !r.sendHeld(`reply:${resource}`))
      return false;
    const pending = holdAction(resource);
    if (!pending) return false; // Older boolean-only holds need independent review.
    const controller = new AbortController();
    recoveryAbort = controller;
    let response;
    try {
      response = await readApi(
        `/conversations/${id(resource)}/reply-actions/${id(pending.actionId)}`,
        controller.signal,
      );
    } catch (error) {
      if (error?.status === 401) throw error;
      if (active() && error?.status === 403)
        state().replyActionRestricted = true;
      // A failed action check must not prevent newer incoming messages loading.
      return false;
    }
    if (!active() || controller.signal.aborted) return false;
    const proof = response.action;
    if (
      proof?.actionId !== pending.actionId ||
      proof.conversationId !== resource ||
      proof.resendPermitted !== false ||
      holdAction(resource)?.actionId !== pending.actionId
    )
      return false;
    const s = state();
    s.replyActionState = proof.state;
    s.replyActionRestricted = false;
    if (
      !["accepted", "rejected_not_attempted", "rejected_not_accepted"].includes(
        proof.state,
      )
    )
      return false;
    if (
      ["accepted", "rejected_not_accepted"].includes(proof.state) &&
      Number.isSafeInteger(pending.replyGeneration) &&
      generationRequired()
    )
      s.replyGenerationFloor = pending.replyGeneration + 1;
    r.releaseSend(`reply:${resource}`);
    if (
      proof.state === "accepted" &&
      s.replyRevision === s.replyPendingRevision &&
      s.reply?.trim() === s.replyPendingContent
    )
      s.reply = "";
    delete s.replyAction;
    delete s.replyPendingContent;
    delete s.replyPendingRevision;
    s.replyEligibilityActionId = pending.actionId;
    s.sendStatusNeedsRead = true;
    r.clearError?.();
    r.toast(
      proof.state === "accepted"
        ? "Your saved reply was accepted."
        : "Your saved reply was not sent. Your draft is kept.",
    );
    return true;
  }

  async function read(resource, { append = false } = {}) {
    const version = visibilityVersion;
    // Serialize read pages so an earlier refresh cannot overwrite newer pagination.
    while (readFlight) await readFlight.catch(() => {});
    if (!active() || !visible() || version !== visibilityVersion) return;
    const controller = new AbortController();
    readAbort = controller;
    const valid = () =>
      active() &&
      visible() &&
      version === visibilityVersion &&
      !controller.signal.aborted;
    const request = (path) => readApi(path, controller.signal);
    const operation = async () => {
      const s = state();
      if (resource) {
        if (
          !append &&
          s.messages?.length &&
          s.capabilities?.messageChanges === true &&
          s.changeCursor
        ) {
          let result;
          for (let count = 0; count < 3; count++) {
            const cursor = s.changeNextCursor || s.changeCursor;
            try {
              result = await request(
                `/conversations/${id(resource)}/changes?cursor=${id(cursor)}&limit=50`,
              );
            } catch (error) {
              if (
                (error?.payload?.error || error?.code || error?.message) !==
                "texting_message_changes_not_ready"
              )
                throw error;
              result = { resetRequired: true };
              s.capabilities = { ...s.capabilities, messageChanges: false };
            }
            if (!valid()) return;
            if (result.resetRequired) {
              s.changeCursor = null;
              s.changeNextCursor = null;
              s.syncCursor = null;
              s.providerScanCursor = null;
              break;
            }
            if (
              result.conversation?.conversationId !== resource ||
              !Array.isArray(result.messages)
            )
              throw new Error("Conversation updates could not be verified.");
            s.conversation = result.conversation;
            s.messages = mergeConversationMessages(s.messages, result.messages);
            if (r.can("readReporting")) receipts.remember(result);
            s.changeNextCursor = result.nextCursor || null;
            if (!s.changeNextCursor) {
              s.changeCursor = result.changeCursor || s.changeCursor;
              return;
            }
          }
          if (!result?.resetRequired) return;
        }
        const previous = list(s.messages),
          known = new Set(previous.map((message) => String(message.messageId))),
          pages = [];
        let cursor = append
            ? s.cursor
            : s.messageOrder === "provider_id"
              ? s.providerScanCursor
              : s.syncCursor,
          overlaps = false,
          result;
        for (let page = 0; page < (append ? 1 : 3); page++) {
          const query = new URLSearchParams({ order: "latest" });
          if (cursor) query.set("cursor", cursor);
          try {
            result = await request(`/conversations/${id(resource)}?${query}`);
          } catch (error) {
            if (
              (error?.payload?.error || error?.code || error?.message) !==
              "texting_history_index_not_ready"
            )
              throw error;
            result = await request(
              `/conversations/${id(resource)}?order=latest`,
            );
            s.cursor = result.nextCursor || null;
            s.syncCursor = null;
            s.providerScanCursor = null;
            s.changeCursor = null;
            s.changeNextCursor = null;
          }
          if (!valid()) return;
          if (
            result.conversation?.conversationId !== resource ||
            !Array.isArray(result.messages)
          )
            throw new Error("Conversation could not be verified.");
          pages.push(result);
          overlaps = result.messages.some((message) =>
            known.has(String(message.messageId)),
          );
          cursor = result.nextCursor || null;
          if (
            result.messageOrder === "provider_id" ||
            append ||
            !previous.length ||
            overlaps ||
            !cursor
          )
            break;
        }
        if (!valid()) return;
        s.conversation = result.conversation;
        s.messageOrder = result.messageOrder || "latest";
        s.capabilities = result.capabilities || s.capabilities;
        if (result.changeCursor && !s.changeCursor)
          s.changeCursor = result.changeCursor;
        for (const page of pages) {
          s.messages = mergeConversationMessages(s.messages, page.messages, {
            older: append || pages.length > 1,
          });
          if (r.can("readReporting")) receipts.remember(page);
        }
        if (append || !previous.length) s.cursor = cursor;
        if (!append) {
          s.syncCursor =
            s.messageOrder !== "provider_id" &&
            previous.length &&
            !overlaps &&
            cursor
              ? cursor
              : null;
          // UUID order is not time order. Walk one saved page per refresh,
          // including overlapping pages, then restart at the first page.
          if (s.messageOrder === "provider_id") s.providerScanCursor = cursor;
        }
        if (
          !append &&
          previous.length &&
          s.capabilities?.messageChanges !== true
        ) {
          // Older nonterminal statuses and visible history need readback even
          // when the newest page already overlaps. Work stays bounded to90 IDs.
          const candidates = list(s.messages).filter(
            (message) =>
              message.direction === "outbound" &&
              !["DELIVERED", "FAILED", "UNDELIVERED", "REJECTED"].includes(
                String(message.status).toUpperCase(),
              ),
          );
          const offset = s.statusOffset || 0;
          const batch = candidates.slice(offset, offset + 90);
          s.statusOffset =
            offset + batch.length >= candidates.length
              ? 0
              : offset + batch.length;
          if (batch.length) {
            try {
              const proof = await request(
                `/conversations/${id(resource)}/read-proof?includeMessages=true&messageIds=${id(batch.map((message) => message.messageId).join(","))}`,
              );
              if (!valid()) return;
              if (Array.isArray(proof.messages))
                s.messages = mergeConversationMessages(
                  s.messages,
                  proof.messages,
                );
              if (r.can("readReporting")) receipts.remember(proof);
            } catch (error) {
              if (![404, 405].includes(error?.status)) throw error;
            }
          }
        }
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
        const sweep = !append && s.inboxLoaded;
        const head =
          sweep && s.inboxOrder === "recent_activity"
            ? await request("/conversations")
            : null;
        if (!valid()) return;
        let cursor = append ? s.cursor : sweep ? s.inboxScanCursor : null,
          result;
        try {
          const query = new URLSearchParams();
          if (sweep) query.set("order", "provider_id");
          if (cursor) query.set("cursor", cursor);
          result = await request(
            `/conversations${query.size ? `?${query}` : ""}`,
          );
        } catch (error) {
          if (
            (error?.payload?.error || error?.code || error?.message) !==
            "texting_inbox_index_not_ready"
          )
            throw error;
          cursor = null;
          result = await request("/conversations");
          s.cursor = result.nextCursor || null;
          s.inboxScanCursor = result.nextCursor || null;
          s.inboxScanSeen = new Set();
        }
        if (!valid()) return;
        // Conversation IDs are not ordered by recent activity. Scan one page
        // per interval, retain loaded rows, and evict missing rows only after
        // a complete authorized pass through the inbox.
        if (!append && !cursor) s.inboxScanSeen = new Set();
        const seen = (s.inboxScanSeen ||= new Set());
        const items = new Map(
          list(s.items).map((row) => [row.conversationId, row]),
        );
        for (const row of [...list(head?.items), ...list(result.items)]) {
          items.set(row.conversationId, row);
          seen.add(row.conversationId);
        }
        const next = result.nextCursor || null;
        if (!append && !next)
          for (const key of items.keys()) if (!seen.has(key)) items.delete(key);
        s.items = [...items.values()].sort(
          (a, b) => (b.lastMessageAtMs || 0) - (a.lastMessageAtMs || 0),
        );
        if (!s.inboxLoaded || append || (s.cursor && s.cursor === cursor))
          s.cursor = next;
        s.inboxLoaded = true;
        s.inboxOrder =
          head?.order ||
          (!sweep ? result.order : s.inboxOrder) ||
          "provider_id";
        if (!append)
          s.inboxScanCursor =
            !sweep && s.inboxOrder === "recent_activity" ? null : next;
      }
    };
    const pending = operation();
    readFlight = pending;
    try {
      await pending;
    } finally {
      if (readFlight === pending) readFlight = null;
    }
  }
  /** Foreground refresh is bounded, backs off on failures, and never repeats a send. */
  function scheduleUpdate() {
    cancel(pollTimer);
    if (!active() || !started || !visible()) return;
    if (pollReads >= maxPollReads || now() >= pollDeadline) {
      state().updatesPaused = true;
      return;
    }
    const interval = resourceId ? (now() < fastUntil ? 10000 : 15000) : 30000;
    pollTimer = schedule(
      async () => {
        if (!active() || !visible()) return;
        if (pollReads >= maxPollReads || now() >= pollDeadline) {
          state().updatesPaused = true;
          r.changed();
          return;
        }
        if (r.busy() || refreshing || readFlight) {
          scheduleUpdate();
          return;
        }
        pollReads++;
        await refresh(resourceId);
      },
      Math.min(120000, interval * 2 ** Math.min(pollFailures, 3)),
    );
    pollTimer?.unref?.();
  }
  async function load(resource, options = {}) {
    resourceId = resource;
    if (!started) {
      started = true;
      renewPolling();
    }
    try {
      await read(resource, options);
    } catch (error) {
      if (error?.name === "AbortError" && (!active() || !visible())) return;
      throw error;
    }
    if (!active()) return;
    if (await reconcileReply(resource)) await refresh(resource);
    scheduleUpdate();
  }
  async function refresh(resource = resourceId, { resume = false } = {}) {
    if (!active() || refreshing || !visible()) return;
    if (resume) renewPolling();
    refreshing = true;
    let eligibilityActionId = state().replyEligibilityActionId;
    try {
      r.guard();
      await reconcileReply(resource);
      if (!active() || !visible()) return;
      eligibilityActionId = state().replyEligibilityActionId;
      if (state().sendStatusNeedsRead || eligibilityActionId) {
        await r.refreshSendStatus();
        if (!active()) return;
        state().sendStatusNeedsRead = false;
      }
      await read(resource);
      if (active() && visible()) {
        state().refreshError = false;
        pollFailures = 0;
        if (
          state().replyEligibilityActionId === eligibilityActionId &&
          generationReady(state().conversation, state().replyGenerationFloor)
        ) {
          delete state().replyEligibilityActionId;
          delete state().replyGenerationFloor;
        }
      }
    } catch (error) {
      if (!active()) {
        dispose();
        return;
      }
      if (error?.name === "AbortError" || !visible()) return;
      if (error?.status === 401 || error?.status === 403) {
        dispose();
        r.fail(error);
        r.changed();
        return;
      }
      state().refreshError = true;
      pollFailures = Math.min(8, pollFailures + 1);
    } finally {
      refreshing = false;
      if (active()) {
        scheduleUpdate();
        r.changed();
      }
    }
  }
  function attachments(message, s) {
    if (s.conversation?.stream !== "opt_in") return "";
    return list(message.attachments)
      .map((attachment) => {
        const key = JSON.stringify([
          String(message.messageId),
          String(attachment.attachmentId),
        ]);
        const image = protectedMediaData(s.protectedAttachments?.[key]);
        return image
          ? `<img src="${e(image)}" alt="Message attachment" loading="lazy">`
          : button("conversation-attachment", "View attachment", {
              secondary: true,
              disabled: r.busy(),
              value: key,
            });
      })
      .join("");
  }
  function updateNotice() {
    const s = state();
    return s.updatesPaused
      ? notice(
          "Live updates paused",
          "Refresh to continue checking for new replies.",
        )
      : s.refreshError
        ? notice(
            "Updates are delayed",
            "Your messages and draft are kept. Refresh to check again.",
          )
        : "";
  }
  function recoveryControls(conversation) {
    const s = state(),
      clearance = conversation.replyClearance;
    const exact = holdAction(conversation.conversationId);
    return (
      button("reply-recovery", exact ? "Check saved reply" : "Check recovery", {
        secondary: true,
        disabled: r.busy(),
      }) +
      (clearance?.canResume === true ||
      (exact && s.replyActionState === "not_found")
        ? button(
            "reply-clearance",
            clearance?.canResume ? "Continue recovery check" : "Check recovery",
            {
              secondary: true,
              disabled: r.busy(),
            },
          )
        : "") +
      (clearance?.canTakeOver === true
        ? button("reply-clearance-takeover", "Take over recovery check", {
            secondary: true,
            disabled: r.busy(),
          })
        : "")
    );
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
        updateNotice() +
        `<section class="pt-card">${list(s.items).length ? s.items.map((row) => `<div class="pt-row"><div><strong>${e(row.displayName || row.phone)}</strong><p class="pt-muted">${Number.isSafeInteger(row.unreadReplies) ? `${e(row.unreadReplies)} unread Â· ` : ""}${e(when(row.lastMessageAtMs))} Â· ${row.suppressed ? "Opted out" : e(label(row.status))}</p></div>${go("conversation", "Open", row.conversationId, true)}</div>`).join("") : `<h2>No conversations yet</h2><p class="pt-muted">Messages appear after verified sending and reply notifications.</p>`}${s.cursor ? button("conversations-more", "Load more", { secondary: true }) : ""}</section>`
      );
    if (!c) return "";
    const hold = r.sendHeld(`reply:${c.conversationId}`),
      price = messagePrice(r.billing(), s.reply || "", false, c.stream),
      canReply =
        r.workspace()?.canSend === true &&
        c.canReply === true &&
        !c.suppressed &&
        !hold &&
        !s.replyEligibilityActionId &&
        generationReady(c, s.replyGenerationFloor) &&
        messageFundingReady(
          r.workspace(),
          r.billing(),
          s.reply || "",
          false,
          c.stream,
        );
    return (
      head(
        "CONVERSATION",
        c.displayName || c.phone,
        c.displayName ? c.phone : "",
        go("inbox", "All conversations", "", true) +
          outcomes.trigger({ conversationId: c.conversationId }),
      ) +
      `${s.preparingAccess ? notice("Preparing your texting accessâ€¦") : ""}${s.replyEligibilityActionId ? notice("Check reply eligibility", "Refresh to check current sending access and conversation status before trying again. Your draft is saved.") : ""}<div class="pt-grid pt-grid--two"><section class="pt-card"><div class="pt-row"><span class="pt-tag">${c.suppressed ? "Opted out" : e(label(c.status))}</span>${button("conversations-refresh", "Refresh", { secondary: true })}</div>${s.cursor ? button("conversations-more", s.messageOrder === "provider_id" ? "Load more messages" : "Load older messages", { secondary: true, disabled: r.busy() }) : ""}${s.syncCursor ? notice("Checking newer messages", "Saved history is kept while the remaining updates load.") : ""}<div class="pt-workspace-thread" data-texting-thread data-conversation-id="${e(c.conversationId)}" tabindex="0" role="region" aria-label="Conversation messages">${
        list(s.messages)
          .map(
            (message) =>
              `<article data-texting-message-id="${e(String(message.messageId))}" class="pt-workspace-message ${message.direction === "outbound" ? "pt-workspace-message--out" : ""}"><div class="pt-workspace-bubble">${list(
                message.media,
              )
                .map((media) =>
                  checkedUrl(media.url)
                    ? `<img src="${e(checkedUrl(media.url))}" alt="${e(media.name || "Message attachment")}" referrerpolicy="no-referrer" loading="lazy">`
                    : `<p>Attachment unavailable</p>`,
                )
                .join(
                  "",
                )}${attachments(message, s)}<p>${e(message.content)}</p></div><small class="pt-muted">${message.direction === "outbound" ? "Sent" : "Received"} Â· ${e(when(message.createdAtMs))} Â· ${e(label(message.status))}</small></article>`,
          )
          .join("") || `<p class="pt-muted">No recorded messages yet.</p>`
      }</div>${c.suppressed ? notice("This person opted out", "Sending is blocked for this recipient.") : hold || c.replyState === "provider_outcome_unknown" ? notice("Reply needs review", s.replyActionRestricted ? "This saved reply belongs to a campaign you can no longer review. Your current conversation remains available. Ask an organization texting manager to review the saved outcome." : "Check recovery before continuing. Checking will not send this reply again.") + recoveryControls(c) : `<form data-workspace-form="reply">${textarea("reply", "Reply", s.reply || "", true)}<div class="pt-row"><span class="pt-muted">Text reply${r.can("manageBilling") ? ` Â· ${price === null ? "Rate unavailable" : rateMoney(price)}` : ""}</span><button class="pt-btn" type="submit"${!canReply || r.busy() ? " disabled" : ""}>Send reply</button></div>${!c.canReply ? `<p class="pt-muted">Replies are paused until this conversation is eligible for a response.</p>` : ""}</form>`}</section><aside class="pt-card"><h2>Contact details</h2>${c.stream ? `<p class="pt-muted">${e(streamLabel(c.stream))}${c.senderPhone || c.fromNumber ? ` Â· ${e(c.senderPhone || c.fromNumber)}` : ""}</p>` : ""}<div class="pt-row"><span>Phone</span><strong>${e(c.phone)}</strong></div><div class="pt-row"><span>Texting status</span><strong>${c.suppressed ? "Opted out" : "No opt-out recorded"}</strong></div><p class="pt-muted">A reply does not establish written opt-in.</p>${c.canSuppress && !c.suppressed ? button("conversation-suppress", "Record opt-out", { secondary: true, disabled: r.busy() }) : ""}${c.suppressed && c.providerSyncState ? `<p class="pt-muted">Vendor opt-out: ${e(label(c.providerSyncState))}</p>` : ""}${c.canSyncSuppression ? button("conversation-sync", "Check vendor opt-out", { secondary: true, disabled: r.busy() }) : ""}${go("campaigns", "View campaign", c.campaignId, true)}</aside></div>`
    );
  }
  async function submit(kind, form) {
    if (await outcomes.submit(kind, form)) return true;
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
      s.replyEligibilityActionId ||
      !generationReady(c, s.replyGenerationFloor) ||
      !r.workspace()?.canSend ||
      !messageFundingReady(r.workspace(), r.billing(), content, false, c.stream)
    )
      throw new Error(
        "This reply is not eligible to send. Check the saved status.",
      );
    await prepareTextingAccess(r, s, c.campaignId);
    const actionId = uuid(),
      messageIds = new Set(
        list(s.messages).map((message) => String(message.messageId)),
      );
    s.replyAction = {
      actionId,
      conversationId: c.conversationId,
      ...(Number.isSafeInteger(c.replyGeneration)
        ? { replyGeneration: c.replyGeneration }
        : {}),
    };
    s.replyPendingContent = content;
    s.replyPendingRevision = s.replyRevision;
    r.holdSend(key, s.replyAction);
    let result;
    try {
      result = (
        await r.api(`/conversations/${id(c.conversationId)}/reply`, {
          actionId,
          content,
          replyGeneration: c.replyGeneration,
        })
      ).result;
    } catch (error) {
      if (textingRequestWasNotDispatched(error)) {
        r.releaseSend(key);
        delete s.replyAction;
        delete s.replyPendingContent;
        delete s.replyPendingRevision;
        throw error;
      }
      const proof = error?.payload;
      // A fresh conversation's canReply flag cannot resolve a lost response.
      // Only the server's durable rejection of this exact action clears its hold.
      if (
        proof?.ok !== false ||
        proof.sendOutcome !== "not_attempted" ||
        proof.actionId !== actionId ||
        typeof proof.error !== "string"
      )
        throw error;
      r.guard();
      s.replyEligibilityActionId = actionId;
      r.releaseSend(key);
      delete s.replyAction;
      delete s.replyPendingContent;
      delete s.replyPendingRevision;
      if (!s.reply || s.reply.trim() === content) s.reply = content;
      s.sendStatusNeedsRead = true;
      r.toast(
        "Reply was not sent. Review the current status before trying again.",
      );
      await refresh(c.conversationId);
      return true;
    }
    if (result?.actionId !== actionId)
      throw new Error("The reply outcome could not be verified.");
    if (result.state === "accepted") {
      r.releaseSend(key);
      delete s.replyAction;
      if (
        s.replyRevision === s.replyPendingRevision &&
        s.reply?.trim() === content
      )
        s.reply = "";
      delete s.replyPendingContent;
      delete s.replyPendingRevision;
      pendingReply = { content, messageIds };
      s.replyEligibilityActionId = actionId;
      if (generationRequired()) s.replyGenerationFloor = c.replyGeneration + 1;
      renewPolling();
      fastUntil = now() + 60000;
      r.toast("Reply accepted. Delivery updates will appear here.");
    } else r.toast("Reply outcome needs review. Do not resend.");
    s.sendStatusNeedsRead = true;
    await refresh(c.conversationId);
    return true;
  }
  async function action(name, value) {
    if (await outcomes.action(name, value)) return true;
    const s = state(),
      c = s.conversation;
    if (
      [
        "reply-recovery",
        "reply-clearance",
        "reply-clearance-takeover",
      ].includes(name)
    ) {
      if (
        !c ||
        (!r.sendHeld(`reply:${c.conversationId}`) &&
          c.replyState !== "provider_outcome_unknown")
      )
        return true;
      if (
        name === "reply-recovery" &&
        holdAction(c.conversationId) &&
        c.replyClearance?.canResume !== true
      ) {
        await refresh(c.conversationId, { resume: true });
        return true;
      }
      const takeover = name === "reply-clearance-takeover";
      if (takeover && c.replyClearance?.canTakeOver !== true)
        throw new Error("This recovery check cannot be taken over.");
      if (
        name === "reply-clearance" &&
        c.replyClearance?.canResume !== true &&
        s.replyActionState !== "not_found"
      )
        throw new Error("Check the saved reply before starting recovery.");
      if (
        !takeover &&
        c.replyClearance?.canResume === true &&
        /^[A-Za-z0-9_-]{1,100}$/.test(c.replyClearance.clearanceId || "")
      )
        s.clearanceRequestId = c.replyClearance.clearanceId;
      else if (takeover) s.takeoverRequestId ||= uuid();
      else
        s.clearanceRequestId ||=
          r.recoveryRequestId?.(`reply:${c.conversationId}`) || uuid();
      const result = await r.api(
        `/conversations/${id(c.conversationId)}/reply-clearance`,
        {
          requestId: takeover ? s.takeoverRequestId : s.clearanceRequestId,
          ...(takeover ? { takeover: true } : {}),
        },
      );
      r.guard();
      if (
        result.state === "cleared" &&
        typeof result.clearanceId === "string" &&
        Number.isSafeInteger(result.replyGeneration)
      ) {
        s.replyEligibilityActionId = result.clearanceId;
        s.replyGenerationFloor = result.replyGeneration;
        s.sendStatusNeedsRead = true;
        r.releaseSend(`reply:${c.conversationId}`);
        delete s.replyAction;
        delete s.replyActionState;
        s.clearanceState = null;
        await refresh(c.conversationId, { resume: true });
      } else {
        if (/^[A-Za-z0-9_-]{1,100}$/.test(result.clearanceId || ""))
          s.clearanceRequestId = result.clearanceId;
        s.clearanceState =
          result.state === "checking" ? "checking" : "needs_review";
        r.toast(
          s.clearanceState === "checking"
            ? "Recovery is being checked. Check recovery again to continue."
            : "This reply still needs manager review. It has not been sent again.",
        );
        await refresh(c.conversationId, { resume: true });
      }
      return true;
    }
    if (name === "conversation-attachment") {
      const [messageId, attachmentId] = JSON.parse(value);
      const message = list(s.messages).find(
        (entry) => String(entry.messageId) === messageId,
      );
      if (
        c?.stream !== "opt_in" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(messageId) ||
        !/^\d{1,2}$/.test(attachmentId) ||
        !list(message?.attachments).some(
          (entry) => String(entry.attachmentId) === attachmentId,
        )
      )
        throw new Error("Attachment is unavailable.");
      const result = await r.api(
        `/conversations/${id(c.conversationId)}/messages/${id(messageId)}/attachments/${id(attachmentId)}`,
      );
      r.guard();
      if (!protectedMediaData(result.media))
        throw new Error("Attachment is unavailable.");
      s.protectedAttachments ||= {};
      s.protectedAttachments[value] = result.media;
      return true;
    }
    if (name === "conversations-refresh" || name === "conversations-more") {
      if (name === "conversations-refresh") {
        s.sendStatusNeedsRead = Boolean(r.context().resourceId);
        await refresh(r.context().resourceId, { resume: true });
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
    if (outcomes.change(target)) return true;
    if (target.name === "reply") {
      state().reply = target.value;
      state().replyRevision = (state().replyRevision || 0) + 1;
      return true;
    }
    return false;
  }
  return {
    load,
    render: () => {
      const html = render() + outcomes.render();
      if (r.context().resourceId && state().conversation) receipts.schedule();
      return (
        html +
        (state().readError
          ? notice(
              "Unread status could not be saved",
              "Refresh this conversation to try again.",
            )
          : "")
      );
    },
    submit,
    action,
    change,
    refresh,
    dispose,
  };
}
