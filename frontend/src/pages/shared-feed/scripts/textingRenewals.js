import { escapeText as e, list, notice } from "./textingWorkspaceUi";

/** Renewal details are administrative information; volunteers receive sending status only. */
export function renderTextingRenewals(
  deadlines,
  administrator,
  className = "pt-notice",
) {
  if (!administrator) return "";
  return list(deadlines)
    .filter(
      (entry) =>
        entry.status !== "current" && Number.isSafeInteger(entry.expiresAtMs),
    )
    .map(
      (entry) =>
        `<div class="${e(className)}" role="status"><strong>${e(entry.label || "Texting review")} ${entry.status === "expired" ? "needs renewal" : "is due soon"}</strong><p>${e(new Date(entry.expiresAtMs).toLocaleDateString())} · ${e(entry.owner || "Polis support")}</p><p>${e(entry.nextStep || "Contact Polis support to complete the review before this date.")}</p></div>`,
    )
    .join("");
}

export function renderTextingSetup(setup) {
  return setup?.manualReviewRequired && setup.state !== "ready"
    ? notice(
        "Manual setup review required",
        setup.nextStep ||
          "Contact Polis support to complete your organization's texting setup. Your saved work remains available.",
      )
    : "";
}
