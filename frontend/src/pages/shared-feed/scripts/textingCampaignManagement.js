import {
  button,
  escapeText as e,
  field,
  id,
  label,
  list,
  money,
  notice,
  uuid,
} from "./textingWorkspaceUi";

const localInput = (ms) => {
  if (!Number.isSafeInteger(ms)) return "";
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const eligible = (campaign) =>
  ["prepared", "active", "paused"].includes(campaign?.status);

/** Managers change limits independently of frozen content and recover only
 * server-approved, untouched recipient assignments. No action sends a text. */
export function createCampaignManagement(r, state) {
  const path = () => `/campaigns/${id(state().campaign.campaignId)}`;
  const limitsAllowed = () =>
    state().campaign?.canManageLimits === true && eligible(state().campaign);
  const recoveryAllowed = () => state().campaign?.canRecoverQueue === true;
  const holdKey = (itemId) =>
    `queue-recovery:${state().campaign.campaignId}:${itemId}`;
  const allocationHoldKey = (allocationId) =>
    `queue-recovery-allocation:${state().campaign.campaignId}:${allocationId}`;
  const checkedCampaign = (campaign, prior) => {
    r.guard();
    if (
      campaign?.campaignId !== prior.campaignId ||
      !Number.isSafeInteger(campaign.revision) ||
      campaign.revision < prior.revision
    )
      throw new Error("Campaign status could not be verified. Refresh it.");
    return campaign;
  };
  async function refreshLimits() {
    const s = state(),
      prior = s.campaign;
    const campaign = checkedCampaign((await r.api(path())).campaign, prior);
    s.campaign = campaign;
    s.draft = { ...campaign };
    s.limitsDraft = null;
    s.limitsNeedsRead = false;
  }
  async function loadRecovery(more = false) {
    if (!recoveryAllowed())
      throw new Error("Recipient recovery is unavailable.");
    const s = state(),
      campaign = s.campaign;
    s.recoveryNeedsRead = true;
    const result = await r.api(
      `${path()}/queue-recovery?limit=50${more && s.recoveryCursor ? `&cursor=${id(s.recoveryCursor)}` : ""}`,
    );
    r.guard();
    if (
      result.campaignId !== campaign.campaignId ||
      !Number.isSafeInteger(result.campaignRevision) ||
      result.campaignRevision < campaign.revision ||
      (more && result.campaignRevision !== s.recoveryRevision) ||
      !Array.isArray(result.allocations)
    )
      throw new Error("Held recipients could not be verified. Refresh them.");
    s.recoveryRevision = result.campaignRevision;
    s.recoveryAllocations = [
      ...(more ? list(s.recoveryAllocations) : []),
      ...result.allocations,
    ];
    s.recoveryCursor = result.nextCursor;
    s.recoveryLoaded = true;
    s.recoveryNeedsRead = false;
  }
  function renderLimits() {
    const s = state(),
      c = s.campaign,
      draft = s.limitsDraft;
    if (!limitsAllowed()) return "";
    return `<section class="pt-card" aria-label="Campaign limits"><h2>Campaign limits</h2><p class="pt-muted">Increase the spending limit or extend the end date. The saved message and recipients stay the same. These changes do not add funds or send messages.</p>${s.limitsNeedsRead ? notice("Check saved limits", "The update could not be confirmed. Refresh the saved campaign before making another change.") + button("campaign-limits-refresh", "Refresh campaign limits", { secondary: true, disabled: r.busy() }) : ""}${draft ? `<form data-workspace-form="campaign-limits"><div class="pt-fields">${c.canManageBudget === true ? field("campaignLimit", "Spending limit ($)", draft.budget, { type: "number", required: true, extra: `min="${(draft.originalBudget / 1000000).toFixed(2)}" step="0.01"` }) : ""}${field("campaignLimitEnd", "Campaign end", draft.end, { type: "datetime-local", required: true })}</div><p class="pt-muted">Your local time. Daily sending hours and current permissions still apply.</p><div class="pt-actions"><button type="submit" class="pt-btn"${r.busy() || s.limitsNeedsRead ? " disabled" : ""}>Save campaign limits</button>${button("campaign-limits-cancel", "Cancel", { secondary: true, disabled: r.busy() })}</div></form>` : `<div class="pt-row"><div>${c.canManageBudget === true ? `<p>Spending limit: <strong>${money(c.budgetMicros)}</strong></p>` : ""}<p>Campaign end: <strong>${e(new Date(c.deliveryBeforeMs).toLocaleString())}</strong></p></div>${button("campaign-limits-edit", "Edit campaign limits", { secondary: true, disabled: r.busy() || s.limitsNeedsRead })}</div>`}</section>`;
  }
  function renderRecovery() {
    const s = state();
    if (!recoveryAllowed()) return "";
    const allocations = list(s.recoveryAllocations);
    return `<section class="pt-card" aria-label="Stranded recipients"><h2>Stranded recipients</h2><p class="pt-muted">Review saved assignments from removed volunteers or stopped campaigns. Only untouched recipients can be skipped. Uncertain outcomes remain held for review.</p>${s.recoveryNeedsRead ? notice("Refresh held recipients", "Check the saved assignments before taking another action.") : ""}<div class="pt-actions">${button("campaign-recovery-refresh", s.recoveryLoaded ? "Refresh held recipients" : "Review stranded recipients", { secondary: true, disabled: r.busy() })}</div>${
      s.recoveryLoaded
        ? allocations
            .map(
              (allocation) =>
                `<article><h3>Held assignment · ${e(label(allocation.state))}</h3>${
                  list(allocation.items)
                    .map((item) => {
                      const completed = s.recoveryCompleted?.has(item.itemId);
                      const held =
                        r.sendHeld(holdKey(item.itemId)) ||
                        r.sendHeld(allocationHoldKey(allocation.allocationId));
                      const canSkip =
                        item.canSkip === true &&
                        !s.recoveryNeedsRead &&
                        !held &&
                        !completed;
                      return `<div class="pt-row"><div><strong>${e(item.preview?.contactDisplayName || item.preview?.contactPhone || "Recipient")}</strong>${item.preview?.contactDisplayName && item.preview?.contactPhone ? `<p>${e(item.preview.contactPhone)}</p>` : ""}<p class="pt-muted">${completed ? "Skipped" : held || item.state === "skip_unknown" || item.state === "provider_outcome_unknown" ? "Outcome needs review. Do not repeat this action." : item.canSkip === true ? "Unsent recipient" : "This assignment needs review before it can be changed."}</p></div>${button("campaign-recovery-skip", "Skip recipient", { value: item.itemId, secondary: true, disabled: r.busy() || !canSkip })}</div>`;
                    })
                    .join("") ||
                  '<p class="pt-muted">This saved assignment needs administrator review. No recipient can be skipped here.</p>'
                }</article>`,
            )
            .join("") ||
          '<p class="pt-muted">No stranded recipients on this page.</p>'
        : ""
    }${s.recoveryCursor ? button("campaign-recovery-more", "More held assignments", { secondary: true, disabled: r.busy() || s.recoveryNeedsRead }) : ""}</section>`;
  }
  async function submit(kind, form) {
    if (kind !== "campaign-limits") return false;
    const s = state(),
      c = s.campaign,
      draft = s.limitsDraft;
    if (!limitsAllowed() || !draft || s.limitsNeedsRead)
      throw new Error("Refresh campaign limits before making a change.");
    const values = new FormData(form),
      body = { expectedRevision: draft.revision };
    draft.end = String(values.get("campaignLimitEnd") || "");
    if (c.canManageBudget === true) {
      draft.budget = String(values.get("campaignLimit") || "");
      // Existing caps may have micro-dollar precision. An unchanged display
      // must not round the saved cap during an end-only edit.
      if (draft.budget !== (draft.originalBudget / 1000000).toFixed(2)) {
        const cents = Math.round(Number(draft.budget) * 100),
          amount = cents * 10000;
        if (
          !/^\d+(?:\.\d{1,2})?$/.test(draft.budget) ||
          !Number.isSafeInteger(amount) ||
          amount < draft.originalBudget
        )
          throw new Error(
            "Enter a spending limit at least as large as the current limit.",
          );
        if (amount > draft.originalBudget) body.budgetMicros = amount;
      }
    }
    // datetime-local has minute precision; preserve the exact saved end unless
    // the manager changed it, including any existing seconds/milliseconds.
    if (draft.end !== localInput(draft.originalEnd)) {
      const end = new Date(draft.end).getTime();
      if (
        !Number.isSafeInteger(end) ||
        end <= draft.originalEnd ||
        end <= Date.now()
      )
        throw new Error("Choose a later campaign end date in the future.");
      body.deliveryBeforeMs = end;
    }
    if (Object.keys(body).length === 1)
      throw new Error(
        "Increase the spending limit or extend the end date first.",
      );
    s.limitsNeedsRead = true;
    const saved = checkedCampaign(
      (await r.api(`${path()}/limits`, body, "PATCH")).campaign,
      c,
    );
    if (
      saved.revision <= draft.revision ||
      Object.entries(body).some(
        ([key, value]) => key !== "expectedRevision" && saved[key] !== value,
      )
    )
      throw new Error("Campaign limits could not be verified. Refresh them.");
    s.campaign = saved;
    s.draft = { ...saved };
    s.limitsDraft = null;
    s.limitsNeedsRead = false;
    r.toast("Campaign limits saved.");
    return true;
  }
  async function action(name, value) {
    const s = state(),
      c = s.campaign;
    if (name === "campaign-limits-refresh") {
      await refreshLimits();
      return true;
    }
    if (name === "campaign-limits-cancel") {
      s.limitsDraft = null;
      return true;
    }
    if (name === "campaign-limits-edit") {
      if (!limitsAllowed() || s.limitsNeedsRead)
        throw new Error("Campaign limits are unavailable.");
      s.limitsDraft = {
        revision: c.revision,
        originalBudget: c.budgetMicros,
        originalEnd: c.deliveryBeforeMs,
        budget: Number.isSafeInteger(c.budgetMicros)
          ? (c.budgetMicros / 1000000).toFixed(2)
          : "",
        end: localInput(c.deliveryBeforeMs),
      };
      return true;
    }
    if (
      name === "campaign-recovery-refresh" ||
      name === "campaign-recovery-more"
    ) {
      await loadRecovery(name.endsWith("-more"));
      return true;
    }
    if (name !== "campaign-recovery-skip") return false;
    const allocation = list(s.recoveryAllocations).find((row) =>
      list(row.items).some((item) => item.itemId === value),
    );
    const item = allocation?.items.find((row) => row.itemId === value);
    const key = holdKey(value);
    const allocationKey = allocationHoldKey(allocation?.allocationId);
    if (
      !recoveryAllowed() ||
      s.recoveryNeedsRead ||
      item?.canSkip !== true ||
      r.sendHeld(key) ||
      r.sendHeld(allocationKey) ||
      s.recoveryCompleted?.has(value)
    )
      throw new Error("Refresh this saved assignment before taking an action.");
    if (!window.confirm("Skip this unsent recipient? This sends no message."))
      return true;
    r.guard();
    const actionId = uuid();
    r.holdSend(key);
    r.holdSend(allocationKey);
    s.recoveryNeedsRead = true;
    const result = (
      await r.api(`${path()}/queue-recovery/${id(value)}/skip`, {
        expectedRevision: s.recoveryRevision,
        userId: allocation.userId,
        allocationId: allocation.allocationId,
        actionId,
      })
    ).result;
    r.guard();
    if (
      result?.actionId !== actionId ||
      result.itemId !== value ||
      result.resendPermitted !== false
    )
      throw new Error(
        "The skip outcome could not be verified. Do not repeat it.",
      );
    if (result.state === "accepted") {
      (s.recoveryCompleted ||= new Set()).add(value);
      r.releaseSend(key);
      r.releaseSend(allocationKey);
      r.toast("Recipient skipped. No message was sent.");
    } else if (result.state === "provider_outcome_unknown") {
      r.toast("The skip outcome needs review. Do not repeat it.");
    } else
      throw new Error(
        "The skip outcome could not be verified. Do not repeat it.",
      );
    await loadRecovery();
    return true;
  }
  function change(target) {
    const draft = state().limitsDraft;
    if (!draft || !target.closest?.('[data-workspace-form="campaign-limits"]'))
      return false;
    if (target.name === "campaignLimit") draft.budget = target.value;
    else if (target.name === "campaignLimitEnd") draft.end = target.value;
    else return false;
    return true;
  }
  return {
    render: () => renderLimits() + renderRecovery(),
    submit,
    action,
    change,
  };
}
