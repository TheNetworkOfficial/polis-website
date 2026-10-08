import { button, escapeText as e, go } from "./textingWorkspaceUi";

export const textingFolders = [
  ["all", "All"],
  ["replies", "Replies"],
  ["unread", "Unread"],
  ["sent", "Sent"],
  ["opt_outs", "Opt outs"],
  ["needs_review", "Needs review"],
];

export function textingFolderRoute(folder = "all", campaignId = "") {
  return `folder:${folder}${campaignId ? `:${campaignId}` : ""}`;
}

export function parseTextingFolder(resource) {
  const match = /^folder:([a-z_]+)(?::([A-Za-z0-9_-]{1,100}))?$/.exec(
    resource || "",
  );
  return match && textingFolders.some(([key]) => key === match[1])
    ? { folder: match[1], campaignId: match[2] || "" }
    : null;
}

export function renderTextingFolders(folder, campaignId = "") {
  return `<nav class="pt-texting-folders" aria-label="Message folders">${textingFolders.map(([key, title]) => button("conversation-folder", title, { secondary: key !== folder, value: key }).replace("<button ", `<button aria-pressed="${key === folder}" `)).join("")}</nav>${campaignId ? `<div class="pt-texting-campaign-nav">${go("send", "To send", campaignId, true)}${go("inbox", "All campaigns", textingFolderRoute(folder), true)}</div>` : ""}`;
}

/** Folder membership comes from the authorized server page, never this page's count. */
export function renderTextingInbox(items, { folder, cursor, busy, when }) {
  const title = textingFolders.find(([key]) => key === folder)?.[1] || "All";
  return `<section class="pt-card pt-texting-inbox" aria-label="${e(title)}">${items.length ? items.map((row) => `<article class="pt-texting-conversation"><div class="pt-texting-person"><strong>${e(row.displayName || row.phone || "Recipient")}</strong>${row.displayName ? `<span class="pt-muted">${e(row.phone)}</span>` : ""}<span class="pt-muted">${row.suppressed ? "Opted out" : row.replyState === "provider_outcome_unknown" ? "Needs review" : row.hasReceivedReply ? "Reply received" : "Sent"}</span></div><div class="pt-texting-conversation-meta">${row.unreadReplies > 0 ? `<span class="pt-tag">${e(row.unreadReplies)} unread</span>` : ""}<time class="pt-muted">${e(when(row.lastMessageAtMs))}</time>${go("conversation", "Open", row.conversationId, true)}</div></article>`).join("") : `<h2>${cursor ? "More conversations to check" : `No ${folder === "all" ? "conversations" : e(title.toLowerCase())} yet`}</h2><p class="pt-muted">${cursor ? "Keep loading to check the remaining conversations in this folder." : "New messages and status updates appear here."}</p>`}${cursor ? button("conversations-more", "Load more", { secondary: true, disabled: busy }) : ""}</section>`;
}
