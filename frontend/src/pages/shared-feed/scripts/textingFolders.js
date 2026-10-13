import { button, escapeText as e } from "./textingWorkspaceUi";

export const textingFolders = [
  ["all", "All messages"],
  ["replies", "Replies"],
  ["opt_outs", "Opt outs"],
  ["needs_review", "Needs review"],
];
const currentFolder = (folder) =>
  ({ unread: "replies", sent: "all" })[folder] || folder;

export function textingFolderRoute(
  folder = "all",
  campaignId = "",
  recent = false,
) {
  return `folder:${currentFolder(folder)}${campaignId || recent ? `:${campaignId}` : ""}${recent ? ":24h" : ""}`;
}

export function parseTextingFolder(resource) {
  const match =
    /^folder:([a-z_]+)(?::([A-Za-z0-9_-]{0,100}))?(?::(24h))?$/.exec(
      resource || "",
    );
  const folder = currentFolder(match?.[1]);
  return match && textingFolders.some(([key]) => key === folder)
    ? { folder, campaignId: match[2] || "", last24Hours: match[3] === "24h" }
    : null;
}

export const conversationUnreadCount = (row) => {
  if (row.suppressed || row.hasConversationalReply === false) return 0;
  const count = row.unreadReplyCount ?? row.unreadReplies;
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
};
export const conversationTime = (row, folder) =>
  folder === "replies"
    ? (row.latestInboundAtMs ?? row.latestInboundMessage?.createdAtMs)
    : row.lastMessageAtMs;

/** Display filters use authorized rows; reply dates never use outbound activity. */
export function conversationInView(
  row,
  { folder = "all", last24Hours = false, windowEnd = Date.now() } = {},
) {
  if (
    folder === "replies" &&
    (row.suppressed || !(row.hasConversationalReply ?? row.hasReceivedReply))
  )
    return false;
  if (folder === "opt_outs" && !row.suppressed) return false;
  if (
    folder === "needs_review" &&
    row.replyState !== "provider_outcome_unknown" &&
    !["pending", "outcome_unknown"].includes(row.providerSyncState)
  )
    return false;
  if (!last24Hours) return true;
  const at = conversationTime(row, folder);
  return (
    Number.isSafeInteger(at) && at >= windowEnd - 86400000 && at <= windowEnd
  );
}

export function renderTextingFolders(
  folder,
  campaignId = "",
  {
    campaigns = [],
    campaignCursor,
    campaignError,
    last24Hours = false,
    busy = false,
  } = {},
) {
  const title =
    textingFolders.find(([key]) => key === folder)?.[1] || "All messages";
  const names = new Map(
    campaigns.map((campaign) => [campaign.campaignId, campaign.name]),
  );
  if (campaignId && !names.has(campaignId))
    names.set(campaignId, "Selected campaign");
  return `<div class="pt-inbox-toolbar"><details class="pt-inbox-folder"><summary aria-label="Message view: ${e(title)}">${e(title)}<span class="pt-inbox-chevron" aria-hidden="true"></span></summary><div class="pt-inbox-folder-menu" role="menu" aria-label="Message views">${textingFolders.map(([key, name]) => `<button type="button" role="menuitemradio" aria-checked="${key === folder}" data-workspace-action="conversation-folder" data-value="${key}"${busy ? " disabled" : ""}><span>${e(name)}</span>${key === folder ? '<span aria-hidden="true">✓</span>' : ""}</button>`).join("")}</div></details><div class="pt-inbox-filters"><label class="pt-inbox-campaign"><select aria-label="Campaign" data-workspace-change="inbox-campaign"${busy ? " disabled" : ""}><option value="">All campaigns</option>${[...names].map(([key, name]) => `<option value="${e(key)}"${key === campaignId ? " selected" : ""}>${e(name)}</option>`).join("")}</select></label><div class="pt-inbox-times" role="group" aria-label="Time range">${[
    ["24h", "24 hr"],
    ["all", "All time"],
  ]
    .map(
      ([key, name]) =>
        `<button type="button" data-workspace-action="conversation-time" data-value="${key}" aria-pressed="${last24Hours === (key === "24h")}"${busy ? " disabled" : ""}>${name}</button>`,
    )
    .join(
      "",
    )}</div></div>${campaignCursor || campaignError ? button("conversation-campaigns-more", campaignError ? "Retry campaigns" : "Load more campaigns", { secondary: true, disabled: busy }) : ""}</div>`;
}

function snippet(row, folder) {
  const message =
    folder === "replies" ? row.latestInboundMessage : row.latestMessage;
  const text =
    typeof message?.content === "string"
      ? message.content.replace(/\s+/g, " ").trim()
      : "";
  if (text || message?.hasMedia)
    return `${message.direction === "outbound" ? "You: " : ""}${text || "Media message"}`;
  const status =
    folder === "replies" ? row.inboundPreviewStatus : row.previewStatus;
  if (status === "available") return "Message";
  return status === "unavailable"
    ? "Message preview unavailable"
    : "Open conversation to view messages";
}

export function renderTextingInbox(
  items,
  {
    folder = "all",
    cursor,
    busy,
    when,
    last24Hours = false,
    windowEnd = Date.now(),
    searching = false,
    searchError = false,
  },
) {
  const title =
    textingFolders.find(([key]) => key === folder)?.[1] || "All messages";
  const visible = items
    .filter((row) =>
      conversationInView(row, { folder, last24Hours, windowEnd }),
    )
    .sort(
      (a, b) =>
        (conversationTime(b, folder) || 0) - (conversationTime(a, folder) || 0),
    );
  const unknownTimes =
    last24Hours &&
    items.some(
      (row) =>
        conversationInView(row, { folder }) &&
        !Number.isSafeInteger(conversationTime(row, folder)),
    );
  return `<section class="pt-inbox-list" aria-label="${e(title)}" aria-busy="${searching}">${
    visible.length
      ? visible
          .map((row) => {
            const unread = conversationUnreadCount(row),
              name = row.displayName || row.phone || "Recipient";
            const status = row.suppressed
              ? "Opted out"
              : row.replyState === "provider_outcome_unknown" ||
                  ["pending", "outcome_unknown"].includes(row.providerSyncState)
                ? "Needs review"
                : "";
            return `<button type="button" class="pt-inbox-message${unread ? " pt-inbox-message--unread" : ""}" data-conversation-id="${e(row.conversationId)}" data-workspace-action="navigate" data-value="${e(JSON.stringify(["conversation", row.conversationId]))}" aria-label="Open conversation with ${e(name)}${unread ? `, ${unread} unread replies` : ""}"><span class="pt-inbox-message-main"><span class="pt-inbox-sender-line"><span class="pt-inbox-sender">${e(name)}</span>${status ? `<span class="pt-inbox-state${status === "Needs review" ? " pt-inbox-state--review" : ""}">${status}</span>` : ""}</span><span class="pt-inbox-preview">${e(snippet(row, folder))}</span></span><span class="pt-inbox-message-meta"><time>${e(when(conversationTime(row, folder)))}</time>${unread ? `<span class="pt-inbox-unread" aria-label="${unread} unread replies">${unread}</span>` : ""}</span></button>`;
          })
          .join("")
      : `<p class="pt-inbox-empty">${searchError ? "More conversations could not be checked. Try Load more." : cursor || searching ? "Searching conversations…" : unknownTimes ? "Some message times could not be checked. Refresh to try again." : "No conversations in this view."}</p>`
  }${visible.length && unknownTimes ? '<p class="pt-inbox-empty" role="status">Some message times could not be checked. Refresh to try again.</p>' : ""}${cursor ? button("conversations-more", "Load more conversations", { secondary: true, disabled: busy || searching }) : ""}</section>`;
}
