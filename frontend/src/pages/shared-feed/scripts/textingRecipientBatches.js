import {
  button,
  count,
  escapeText as e,
  id,
  list,
  money,
  messagePrice,
  notice,
  uuid,
} from "./textingWorkspaceUi";
import { personalizationPreview } from "./textingPersonalization";

/** Additional recipients stay inside the existing campaign. Polling reads status;
 * only the explicit final button approves transfer of a reviewed batch. */
export function createRecipientBatches(
  r,
  state,
  recipients,
  { schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let timer,
    disposed = false,
    reads = 0,
    failures = 0;
  const active = () => {
    try {
      r.guard();
      return !disposed;
    } catch {
      return false;
    }
  };
  const path = (batchId) =>
    `/campaigns/${id(state().campaign.campaignId)}/recipient-batches${batchId ? `/${id(batchId)}` : ""}`;
  const canAdd = () =>
    r.can("appendCampaignRecipients") &&
    r.can("readContactBook") &&
    state().campaign?.canAddRecipients === true &&
    ["draft", "prepared", "active", "paused"].includes(
      state().campaign?.status,
    );
  function arm() {
    cancel(timer);
    if (
      !active() ||
      reads >= 120 ||
      ![...list(state().additionBatches), state().additionBatch].some(
        (row) =>
          row &&
          ["reviewing", "preparing"].includes(row.status) &&
          row.stage !== "awaiting_campaign_activation",
      )
    )
      return;
    timer = schedule(
      async () => {
        if (!active()) return;
        if (globalThis.document?.hidden || r.busy()) {
          arm();
          return;
        }
        try {
          await load();
        } catch {
          /* The saved batch survives a network error. */
        }
      },
      Math.min(
        30_000,
        (reads < 12 ? 5000 : 15_000) * 2 ** Math.min(failures, 2),
      ),
    );
  }
  async function load({ more = false } = {}) {
    if (!active() || !r.can("appendCampaignRecipients") || !state().campaign)
      return;
    const s = state(),
      campaignId = s.campaign.campaignId;
    try {
      reads++;
      const result = await r.api(
        `${path()}?limit=20${more && s.additionCursor ? `&cursor=${id(s.additionCursor)}` : ""}`,
      );
      if (!active() || state().campaign?.campaignId !== campaignId) return;
      s.additionBatches = more
        ? [...list(s.additionBatches), ...list(result.items || result.batches)]
        : list(result.items || result.batches);
      s.additionCursor = result.nextCursor;
      const pendingId = s.campaign.recipientBatchPendingId;
      if (
        pendingId &&
        !s.additionBatches.some((row) => row.batchId === pendingId)
      ) {
        const pending = (await r.api(path(pendingId))).batch;
        if (!active() || state().campaign?.campaignId !== campaignId) return;
        if (pending) s.additionBatches.unshift(pending);
      }
      s.additionBatches = [
        ...new Map(s.additionBatches.map((row) => [row.batchId, row])).values(),
      ];
      const pending = s.additionBatches.find(
        (row) => row.batchId === pendingId,
      );
      if (pending && ["ready", "cancelled"].includes(pending.status)) {
        const campaign = (await r.api(`/campaigns/${id(campaignId)}`)).campaign;
        if (!active() || state().campaign?.campaignId !== campaignId) return;
        s.campaign = campaign;
      }
      if (s.additionBatch) {
        const batch = s.additionBatches.find(
          (row) => row.batchId === s.additionBatch.batchId,
        );
        const selected =
          batch || (await r.api(path(s.additionBatch.batchId))).batch;
        if (!active() || state().campaign?.campaignId !== campaignId) return;
        s.additionBatch = selected;
      }
      s.additionError = "";
      failures = 0;
    } catch (error) {
      if (active()) {
        state().additionError =
          "Progress could not be checked. Your saved additions are kept.";
        failures++;
      }
      throw error;
    } finally {
      if (active()) {
        arm();
        r.changed();
      }
    }
  }
  const status = (row) =>
    row.stage === "awaiting_campaign_activation"
      ? "Waiting for campaign activation"
      : {
          reviewing: "Checking additions…",
          ready_for_review: "Ready to review",
          preparing: "Preparing additions…",
          ready: "Ready for volunteers",
          needs_attention: "Needs attention",
          cancelled: "Cancelled",
        }[row.status] || "Saved";
  function overview() {
    if (!r.can("appendCampaignRecipients")) return "";
    const s = state();
    return `<section class="pt-card"><div class="pt-row"><h2>Recipients</h2>${canAdd() ? button("recipient-batch-open", s.campaign.recipientBatchPendingId ? "View additions" : "Add contacts", { secondary: true, disabled: r.busy() }) : ""}</div>${list(
      s.additionBatches,
    )
      .map(
        (row) =>
          `<div class="pt-row"><div><strong>${count(row.newCount)} additional recipients</strong><p class="pt-muted">${e(status(row))}</p></div>${button("recipient-batch-view", "View", { value: row.batchId, secondary: true })}</div>`,
      )
      .join(
        "",
      )}${s.additionError ? notice("Progress saved", s.additionError) : ""}${reads >= 120 ? '<p class="pt-muted">Your additions are saved. Check progress when you return.</p>' : ""}${button("recipient-batch-refresh", "Check progress", { secondary: true })}${s.additionCursor ? button("recipient-batch-more", "More additions", { secondary: true }) : ""}</section>`;
  }
  function render() {
    if (
      !active() ||
      !r.can("appendCampaignRecipients") ||
      !r.can("readContactBook")
    )
      return notice("Campaign contact access is restricted");
    const s = state(),
      batch = s.additionBatch;
    const next = () =>
      button("recipient-batch-review", "Review additions", {
        disabled: r.busy() || !recipients.hasSelection(),
      });
    if (!batch)
      return `<section><div class="pt-campaign-step-nav"><h2>Add campaign contacts</h2>${button("recipient-batch-close", "Back to campaign", { secondary: true })}</div><p class="pt-muted">Existing recipients stay in this campaign.</p>${next()}${recipients.render()}<div class="pt-actions">${next()}</div></section>`;
    const preview = personalizationPreview(
      s.campaign.templateText,
      r.workspace?.()?.personalization,
    );
    const price = messagePrice(
      r.billing(),
      preview.example,
      Boolean(s.campaign.mediaId),
    );
    const optInPrice =
      s.campaign.routingMode === "dual"
        ? messagePrice(
            r.billing(),
            preview.example,
            Boolean(s.campaign.mediaId),
            "opt_in",
          )
        : price;
    const fixed =
      !preview.error && (!preview.personalized || Boolean(s.campaign.mediaId));
    const totals =
      fixed &&
      Number.isSafeInteger(batch.newCount) &&
      [price, optInPrice].every(Number.isSafeInteger)
        ? [Math.min(price, optInPrice), Math.max(price, optInPrice)].map(
            (rate) => rate * batch.newCount,
          )
        : [];
    const estimate =
      totals.length && totals.every(Number.isSafeInteger)
        ? totals[0] === totals[1]
          ? money(totals[0])
          : `${money(totals[0])} to ${money(totals[1])}`
        : preview.personalized && !s.campaign.mediaId
          ? "Varies by recipient"
          : "Awaiting verified rates";
    const remaining = Math.max(
      0,
      (s.campaign.budgetMicros || 0) -
        (s.campaign.reservedMicros || 0) -
        (s.campaign.settledMicros || 0),
    );
    return `<section class="pt-card"><div class="pt-row"><h2>${e(status(batch))}</h2>${button("recipient-batch-close", "Back to campaign", { secondary: true })}</div>
      <div class="pt-row"><span>New recipients</span><strong>${count(batch.newCount)}</strong></div>
      <div class="pt-row"><span>Already included</span><strong>${count(batch.alreadyIncludedCount)}</strong></div>
      <div class="pt-row"><span>Held from texting</span><strong>${count(batch.heldCount)}</strong></div>
      ${r.can("manageBilling") ? `<div class="pt-row"><span>Estimated additional cost</span><strong>${estimate}</strong></div><div class="pt-row"><span>Remaining campaign limit</span><strong>${money(remaining)}</strong></div>` : ""}
      ${batch.status === "ready_for_review" ? `<p class="pt-muted">Adding shares only these new, eligible recipients with your texting service. Your campaign’s spending limit stays the same.</p>${button("recipient-batch-prepare", `Add ${count(batch.newCount)} recipients`, { disabled: r.busy() || !batch.newCount || !batch.reviewToken || !canAdd() })}` : ""}
      ${batch.status === "ready" ? '<p role="status">These recipients are available in this campaign.</p>' : ""}
      ${batch.status === "needs_attention" ? '<p class="pt-muted">An administrator must check this preparation before new recipients become available.</p>' : ""}
      ${batch.canCancel ? button("recipient-batch-cancel", "Cancel additions", { secondary: true, disabled: r.busy() }) : ""}
      ${s.additionError ? notice("Progress saved", s.additionError) : ""}
    </section>`;
  }
  async function action(name, value) {
    if (!name.startsWith("recipient-batch-")) return false;
    const s = state();
    if (
      !active() ||
      !r.can("appendCampaignRecipients") ||
      !r.can("readContactBook")
    )
      return true;
    if (name === "recipient-batch-open") {
      if (!canAdd()) return true;
      if (s.campaign.recipientBatchPendingId) {
        s.additionBatch = (
          await r.api(path(s.campaign.recipientBatchPendingId))
        ).batch;
        if (!active()) return true;
        s.addingRecipients = true;
        arm();
        return true;
      }
      s.addingRecipients = true;
      s.additionBatch = null;
      s.additionOperationId = uuid();
      delete r.view().recipientBook;
      await recipients.load();
      return true;
    }
    if (name === "recipient-batch-close") {
      s.addingRecipients = false;
      return true;
    }
    if (name === "recipient-batch-cancel") {
      if (!s.additionBatch?.canCancel) return true;
      s.additionBatch = (
        await r.api(`${path(s.additionBatch.batchId)}/cancel`, {})
      ).batch;
      await load();
      return true;
    }
    if (name === "recipient-batch-view") {
      s.additionBatch = (await r.api(path(value))).batch;
      s.addingRecipients = true;
      arm();
      return true;
    }
    if (name === "recipient-batch-refresh" || name === "recipient-batch-more") {
      reads = 0;
      await load({ more: name.endsWith("-more") });
      return true;
    }
    if (name === "recipient-batch-review") {
      if (!canAdd() || !(await recipients.reviewForCampaign())) return true;
      const selection = recipients.selection();
      const campaignId = s.campaign.campaignId;
      const campaign = (await r.api(`/campaigns/${id(campaignId)}`)).campaign;
      if (!active() || state().campaign?.campaignId !== campaignId) return true;
      s.campaign = campaign;
      if (!canAdd()) return true;
      if (campaign.recipientBatchPendingId) {
        s.additionBatch = (
          await r.api(path(campaign.recipientBatchPendingId))
        ).batch;
        arm();
        return true;
      }
      s.additionOperationId ||= uuid();
      s.additionBatch = (
        await r.api(path(), {
          selectionId: selection.selectionId,
          expectedRevision: s.campaign.revision,
          operationId: s.additionOperationId,
        })
      ).batch;
      s.campaign.recipientBatchPendingId = s.additionBatch.batchId;
      await load();
      return true;
    }
    if (name === "recipient-batch-prepare") {
      const batch = s.additionBatch;
      if (
        !canAdd() ||
        batch?.status !== "ready_for_review" ||
        !batch.reviewToken ||
        !batch.newCount
      )
        return true;
      s.additionBatch = (
        await r.api(`${path(batch.batchId)}/prepare`, {
          approved: true,
          reviewToken: batch.reviewToken,
        })
      ).batch;
      await load();
      return true;
    }
    return false;
  }
  return {
    load,
    overview,
    render,
    action,
    dispose() {
      disposed = true;
      cancel(timer);
    },
  };
}
