import { button, count, escapeText as e, notice } from "./textingWorkspaceUi";
import { campaignPreparationPending } from "./textingCampaignPreparation";

const stageText = (stage) =>
  ({
    selected_contacts: "Checking selected contacts",
    provider_transfer: "Preparing contacts for texting",
    message: "Checking the campaign message",
  })[stage] || "Checking saved preparation";

const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

function savedProgress(p) {
  const rows = [];
  if (validCount(p.selectedContactCount))
    rows.push(`${count(p.selectedContactCount)} selected recipients`);
  const progress = p.progress;
  if (
    progress &&
    validCount(progress.totalContactCount) &&
    validCount(progress.submittedContactCount) &&
    validCount(progress.verifiedContactCount) &&
    progress.submittedContactCount <= progress.totalContactCount &&
    progress.verifiedContactCount <= progress.totalContactCount
  ) {
    rows.push(
      `Submitted for preparation: ${count(progress.submittedContactCount)} of ${count(progress.totalContactCount)} recipients`,
      `Confirmed ready: ${count(progress.verifiedContactCount)} of ${count(progress.totalContactCount)} recipients`,
    );
  }
  if (
    Number.isSafeInteger(p.updatedAtMs) &&
    p.updatedAtMs > 0 &&
    p.updatedAtMs <= 8640000000000000
  )
    rows.push(`Last saved update: ${new Date(p.updatedAtMs).toLocaleString()}`);
  return rows.map((text) => `<p class="pt-muted">${e(text)}</p>`).join("");
}

/** Display only understood, customer-facing preparation details. */
export function renderCampaignPreparation(state, { canManage, busy }) {
  const p = state.campaign?.preparation;
  if (!campaignPreparationPending(state.campaign)) return "";
  if (state.campaign.status === "activating") {
    const title = state.preparationPollError
      ? "Campaign status could not be confirmed"
      : state.preparationPollingPaused
        ? "Campaign checks are paused"
        : "Opening campaign…";
    const text =
      state.preparationPollError ||
      state.preparationRetryMessage ||
      (state.preparationPollingPaused
        ? "Your request to open this campaign is saved. Check its status to continue."
        : "Preparing texting access for assigned volunteers and opening this campaign. This page checks progress automatically; you can return later.");
    return `<section aria-label="Campaign activation">${notice(title, text)}<div class="pt-actions">${button("campaign-refresh", "Check campaign now", { secondary: true, disabled: busy })}</div></section>`;
  }
  const needsAttention = p.status === "needs_attention";
  const canResume = p.canResume === true && canManage;
  const waitingForReview = needsAttention && !canResume;
  const originalApprover =
    !canResume && p.recoveryAction === "original_approver";
  const reviewer =
    p.recoveryAction === "operator_review"
      ? "Polis support"
      : "An administrator";
  const title = needsAttention
    ? "Recipient preparation needs attention"
    : state.preparationPollError
      ? "Preparation status could not be confirmed"
      : state.preparationPollingPaused
        ? "Preparation checks are paused"
        : originalApprover && p.status === "ready_to_finalize"
          ? "Ready for the campaign check"
          : p.status === "ready_to_finalize"
            ? "Checking the campaign message…"
            : "Preparing selected recipients…";
  const text =
    state.preparationPollError ||
    state.preparationRetryMessage ||
    (originalApprover
      ? "The person who approved this selection needs to continue its saved preparation. Ask them to open this campaign. Check its status to see their latest progress."
      : waitingForReview
        ? [
            "prompt_provider_records_not_ready",
            "provider_records_not_ready",
          ].includes(p.errorCode)
          ? `The texting service has not confirmed all selected recipients. ${reviewer} must review the saved result before preparation can continue. Your selection is saved. Starting it again will not resolve the issue. Check for an update after the review.`
          : `Your selected recipients are saved. ${reviewer} must review the saved result before preparation can continue. Starting it again will not resolve the issue. Check for an update after the review.`
        : needsAttention
          ? "Preparation stopped before it finished. Your selected recipients and saved progress are retained. Resume saved preparation to continue."
          : state.preparationPollingPaused
            ? "Automatic checks are paused. Your saved preparation is retained. Check its status to continue."
            : "Your approved recipient selection is saved. This page checks progress automatically; you can return later without losing it.");
  const resume =
    canResume &&
    (needsAttention ||
      state.preparationPollError ||
      state.preparationPollingPaused ||
      state.preparationCompletionAttempted ||
      p.automaticResume !== true);
  return `<section aria-label="Recipient preparation">${notice(title, text)}<p class="pt-muted">Saved step: ${e(stageText(p.stage))}</p>${savedProgress(p)}<div class="pt-actions">${resume ? button("campaign-preparation-resume", "Resume saved preparation", { disabled: busy }) : ""}${button("campaign-refresh", "Check preparation now", { secondary: true, disabled: busy })}</div></section>`;
}
