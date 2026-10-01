import { messagePrice, smsSegments } from "./textingWorkspaceUi";

/** Estimate the reviewed audience at the standard rate; final routing is verified at preparation. */
export function estimateContactCampaign(
  billing,
  selection,
  reviewed,
  text,
  media = false,
) {
  const eligible = selection?.eligibleCount;
  const count =
    reviewed &&
    selection?.status === "ready" &&
    Number.isSafeInteger(eligible) &&
    eligible >= 0
      ? eligible
      : null;
  const rate = messagePrice(billing, text, media);
  const total = count === null || rate === null ? null : count * rate;
  return {
    count,
    rate,
    total: Number.isSafeInteger(total) ? total : null,
    segments: media ? null : smsSegments(text),
  };
}
