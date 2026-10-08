/** Merge saved pages without dropping older history or duplicating callbacks. */
export function mergeConversationMessages(
  previous,
  incoming,
  { older = false } = {},
) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(incoming) ? incoming : [];
  const records = new Map(
    before.map((message) => [String(message.messageId), message]),
  );
  for (const message of after) records.set(String(message.messageId), message);
  const order = [
    ...new Set(
      (older ? [...after, ...before] : [...before, ...after]).map((message) =>
        String(message.messageId),
      ),
    ),
  ];
  return order
    .map((key) => records.get(key))
    .sort((a, b) => {
      if (
        Number.isSafeInteger(a.createdAtMs) &&
        Number.isSafeInteger(b.createdAtMs)
      )
        return a.createdAtMs - b.createdAtMs;
      if (/^\d+$/.test(a.messageId) && /^\d+$/.test(b.messageId)) {
        const left = String(a.messageId),
          right = String(b.messageId);
        return left.length - right.length || left.localeCompare(right);
      }
      return 0;
    });
}

/** Preserve the visible message while prepending history or re-rendering a draft. */
export function snapshotConversationScroll(root) {
  const thread = root.querySelector("[data-texting-thread]");
  if (!thread) return null;
  const top = thread.getBoundingClientRect().top;
  const anchor = [...thread.querySelectorAll("[data-texting-message-id]")].find(
    (message) => message.getBoundingClientRect().bottom > top,
  );
  return {
    conversationId: thread.dataset.conversationId,
    scrollTop: thread.scrollTop,
    atEnd: thread.scrollHeight - thread.clientHeight - thread.scrollTop < 48,
    anchorId: anchor?.dataset.textingMessageId,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
  };
}

export function restoreConversationScroll(root, saved) {
  const thread = root.querySelector("[data-texting-thread]");
  if (!thread) return;
  if (
    !saved ||
    saved.conversationId !== thread.dataset.conversationId ||
    saved.atEnd
  ) {
    thread.scrollTop = thread.scrollHeight;
    return;
  }
  const anchor = [...thread.querySelectorAll("[data-texting-message-id]")].find(
    (message) => message.dataset.textingMessageId === saved.anchorId,
  );
  thread.scrollTop = anchor
    ? anchor.getBoundingClientRect().top -
      thread.getBoundingClientRect().top -
      saved.anchorOffset
    : saved.scrollTop;
}
