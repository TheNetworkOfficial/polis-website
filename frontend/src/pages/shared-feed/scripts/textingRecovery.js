import {
  escapeText as e,
  id,
  list,
  label,
  button,
  head,
  notice,
  field,
  uuid,
} from "./textingWorkspaceUi";

/** Recovery checks inspect saved outcomes; evidence requests never authorize a resend. */
export function createTextingRecovery(r) {
  const state = () => (r.view().recovery ||= {});
  async function load(more = false) {
    if (!r.can("recovery"))
      throw Object.assign(new Error("Recovery access is restricted."), {
        status: 403,
      });
    const s = state();
    const result = await r.api(
      `/recovery?limit=25${more && s.cursor ? `&cursor=${id(s.cursor)}` : ""}`,
    );
    r.guard();
    s.items = [
      ...new Map(
        [...(more ? list(s.items) : []), ...list(result.items)].map((item) => [
          item.caseId,
          item,
        ]),
      ).values(),
    ];
    s.cursor = result.nextCursor || null;
  }
  function render() {
    const s = state();
    return (
      head(
        "RECOVERY",
        "Review saved outcomes",
        "Checking a saved outcome never sends the message again.",
        button("recovery-refresh", "Check recovery", {
          secondary: true,
          disabled: r.busy(),
        }),
      ) +
      notice(
        "Evidence stays under review",
        "Submitting evidence requests a review. It does not release held messages, charges, or sending permissions.",
      ) +
      `<section class="pt-card">${
        list(s.items)
          .map(
            (item) =>
              `<article class="pt-row"><div><strong>${e(item.actorDisplayName || item.actorUsername || "Texting team member")}</strong><p>${e(item.nextStep || "Review the saved outcome with Polis support.")}</p><p class="pt-muted">${Number.isSafeInteger(item.heldCount) ? `${e(item.heldCount)} held · ` : ""}${e(label(item.state))}</p>${item.canReconcile ? button("recovery-check", "Check saved outcome", { value: item.caseId, secondary: true, disabled: r.busy() }) : ""}${item.canSubmitEvidence ? `<form data-workspace-form="recovery-evidence" data-case-id="${e(item.caseId)}">${field("evidenceRef", "Evidence reference", s.drafts?.[item.caseId]?.evidenceRef || "", { required: true })}${field("reason", "What should support review?", s.drafts?.[item.caseId]?.reason || "", { required: true })}<button class="pt-btn" type="submit"${r.busy() ? " disabled" : ""}>Request evidence review</button></form>` : ""}</div></article>`,
          )
          .join("") || "<p>No saved outcomes currently need review.</p>"
      }${s.cursor ? button("recovery-more", "Load more recovery cases", { secondary: true, disabled: r.busy() }) : ""}</section>`
    );
  }
  return {
    load,
    render,
    async action(name, value) {
      if (
        !["recovery-refresh", "recovery-more", "recovery-check"].includes(name)
      )
        return false;
      if (name === "recovery-check") {
        if (
          !list(state().items).some(
            (item) => item.caseId === value && item.canReconcile,
          )
        )
          throw new Error("This saved outcome cannot be checked here.");
        await r.api(`/recovery/${id(value)}/reconcile`, {});
      }
      await load(name === "recovery-more");
      return true;
    },
    change(target) {
      const form = target.closest?.(
        '[data-workspace-form="recovery-evidence"]',
      );
      if (!form || !["reason", "evidenceRef"].includes(target.name))
        return false;
      const drafts = (state().drafts ||= {});
      (drafts[form.dataset.caseId] ||= {})[target.name] = target.value;
      return true;
    },
    async submit(kind, form) {
      if (kind !== "recovery-evidence") return false;
      const s = state(),
        caseId = form.dataset.caseId,
        values = new FormData(form);
      if (
        !list(s.items).some(
          (item) => item.caseId === caseId && item.canSubmitEvidence,
        )
      )
        throw new Error("Evidence review is unavailable for this case.");
      const evidenceRef = String(values.get("evidenceRef") || "").trim(),
        reason = String(values.get("reason") || "").trim();
      if (!evidenceRef || !reason)
        throw new Error(
          "Add an evidence reference and explain what support should review.",
        );
      const requests = (s.requests ||= {}),
        fingerprint = JSON.stringify([evidenceRef, reason]);
      if (requests[caseId]?.fingerprint !== fingerprint)
        requests[caseId] = { requestId: uuid(), fingerprint };
      const { requestId } = requests[caseId];
      await r.api(`/recovery/${id(caseId)}/evidence`, {
        requestId,
        evidenceRef,
        reason,
      });
      r.toast(
        "Evidence review requested. The saved outcome remains held until it is verified.",
      );
      await load();
      return true;
    },
    dispose() {},
  };
}
