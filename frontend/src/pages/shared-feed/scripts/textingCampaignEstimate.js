import { messagePrice, smsSegments } from "./textingWorkspaceUi";
import { hasPersonalization } from "./textingPersonalization";

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
  const personalized = hasPersonalization(text);
  const rate =
    personalized && !media ? null : messagePrice(billing, text, media);
  const total = count === null || rate === null ? null : count * rate;
  return {
    count,
    rate,
    total: Number.isSafeInteger(total) ? total : null,
    segments: media || personalized ? null : smsSegments(text),
    personalized,
  };
}
