import { textingReadRequest } from "./textingReadRequest";

/** Acknowledge only inbound messages intersecting the active, visible viewport. */
export function createConversationReads(
  r,
  { active, resource, read, now = Date.now },
) {
  const pending = new Map(),
    acknowledged = new Set();
  let frame = false,
    working = false,
    stopped = false,
    retryAfter = 0,
    controller;
  const current = () =>
    !stopped && active() && globalThis.document?.hidden !== true;
  function remember(page) {
    const expiresAt = page.readTokenExpiresAtMs || now() + 14 * 60000;
    const eligible = Array.isArray(page.readMessageIds)
      ? new Set(page.readMessageIds.map(String))
      : null;
    for (const message of page.messages || []) {
      const messageId = String(message.messageId || "");
      if (
        page.readToken &&
        message.direction === "inbound" &&
        messageId &&
        (!eligible || eligible.has(messageId)) &&
        !acknowledged.has(messageId)
      )
        pending.set(messageId, { token: page.readToken, expiresAt });
    }
  }
  function visibleIds() {
    const thread = globalThis.document?.querySelector?.(
      "[data-texting-thread]",
    );
    if (!thread || thread.dataset.conversationId !== resource()) return [];
    const box = thread.getBoundingClientRect();
    const top = Math.max(0, box.top),
      bottom = Math.min(globalThis.innerHeight || Infinity, box.bottom);
    const left = Math.max(0, box.left),
      right = Math.min(globalThis.innerWidth || Infinity, box.right);
    if (bottom <= top || right <= left) return [];
    return [...thread.querySelectorAll("[data-texting-message-id]")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.bottom > top &&
          rect.top < bottom &&
          rect.right > left &&
          rect.left < right
        );
      })
      .map((node) => node.dataset.textingMessageId)
      .filter((key) => pending.has(key))
      .slice(0, 90);
  }
  async function flush() {
    frame = false;
    if (!current() || working || !pending.size || now() < retryAfter) return;
    working = true;
    controller = new AbortController();
    const conversationId = resource();
    try {
      let ids = visibleIds();
      if (!ids.length) return;
      const expired = ids.filter((key) => pending.get(key).expiresAt <= now());
      if (expired.length) {
        const proof = await read(
          `/conversations/${encodeURIComponent(conversationId)}/read-proof?messageIds=${encodeURIComponent(expired.join(","))}`,
          controller.signal,
        );
        if (!current() || resource() !== conversationId) return;
        if (
          Array.isArray(proof.readMessageIds) &&
          !proof.readMessageIds.length
        ) {
          for (const key of expired) pending.delete(key);
          return;
        }
        if (
          !proof.readToken ||
          !Number.isSafeInteger(proof.readTokenExpiresAtMs)
        )
          throw new Error("Read status could not be verified.");
        const eligible = Array.isArray(proof.readMessageIds)
          ? new Set(proof.readMessageIds.map(String))
          : null;
        for (const key of expired) {
          if (eligible && !eligible.has(key)) {
            pending.delete(key);
            continue;
          }
          pending.set(key, {
            token: proof.readToken,
            expiresAt: proof.readTokenExpiresAtMs,
          });
        }
        ids = visibleIds();
      }
      const groups = new Map();
      for (const key of ids) {
        const token = pending.get(key).token;
        if (!groups.has(token)) groups.set(token, []);
        groups.get(token).push(key);
      }
      for (const [readToken, candidateIds] of groups) {
        if (!current() || resource() !== conversationId) return;
        const stillVisible = new Set(visibleIds());
        const visibleMessageIds = candidateIds.filter((key) =>
          stillVisible.has(key),
        );
        if (!visibleMessageIds.length) continue;
        const result = await textingReadRequest(
          (signal) =>
            r.api(
              `/conversations/${encodeURIComponent(conversationId)}/read`,
              { readToken, visibleMessageIds },
              undefined,
              { signal },
            ),
          { signal: controller.signal },
        );
        if (!current() || resource() !== conversationId) return;
        for (const key of visibleMessageIds) {
          pending.delete(key);
          acknowledged.add(key);
        }
        const state = r.view().conversations;
        if (state?.conversation?.conversationId === conversationId) {
          state.conversation.unreadReplies = result.unreadReplies;
          state.readError = false;
        }
        r.changed();
      }
    } catch (error) {
      if (!current()) return;
      retryAfter = now() + 15000;
      if ([401, 403].includes(error?.status)) r.fail(error);
      else {
        if (error?.status === 400)
          for (const value of pending.values()) value.expiresAt = 0;
        r.view().conversations.readError = true;
      }
      r.changed();
    } finally {
      working = false;
    }
  }
  function schedule() {
    if (
      !current() ||
      frame ||
      !pending.size ||
      typeof requestAnimationFrame !== "function"
    )
      return;
    frame = true;
    requestAnimationFrame(flush);
  }
  globalThis.document?.addEventListener?.("scroll", schedule, true);
  const visibility = () => {
    if (globalThis.document?.hidden) controller?.abort();
    else schedule();
  };
  globalThis.document?.addEventListener?.("visibilitychange", visibility);
  globalThis.window?.addEventListener?.("resize", schedule);
  return {
    remember,
    schedule,
    dispose() {
      stopped = true;
      controller?.abort();
      pending.clear();
      acknowledged.clear();
      globalThis.document?.removeEventListener?.("scroll", schedule, true);
      globalThis.document?.removeEventListener?.(
        "visibilitychange",
        visibility,
      );
      globalThis.window?.removeEventListener?.("resize", schedule);
    },
  };
}
