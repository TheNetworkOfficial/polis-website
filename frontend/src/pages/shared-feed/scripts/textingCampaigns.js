import {
  escapeText as e,
  label,
  money,
  rateMoney,
  count,
  id,
  list,
  button,
  go,
  head,
  stat,
  field,
  notice,
  details,
  reasons,
  uuid,
  smsSegments,
  messagePrice,
  streamLabel,
  queueCanConfirm,
  queueCanSkip,
  queueBlockExplanation,
  checkedUrl,
  protectedMediaData,
} from "./textingWorkspaceUi";
import {
  scheduleFields,
  scheduleSummary,
  readSchedule,
} from "./textingSchedule";
import { prepareTextingAccess, saveAssignmentChanges } from "./textingAccess";
import { createOrganizationContactBook } from "./organizationContactBook";
import { estimateContactCampaign } from "./textingCampaignEstimate";
import { createCampaignPreparation } from "./textingCampaignPreparation";
import { createCampaignDraftStore } from "./textingCampaignDraft";
import { createVolunteerPicker } from "./textingVolunteerPicker";
import { createRecipientOutcomes } from "./textingRecipientOutcomes";
import { createRecipientBatches } from "./textingRecipientBatches";
import {
  availablePersonalization,
  insertPersonalization,
  personalizationPreview,
} from "./textingPersonalization";

const localInput = (ms) => {
  if (!Number.isSafeInteger(ms)) return "";
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const dateText = (ms) =>
  Number.isSafeInteger(ms) ? new Date(ms).toLocaleString() : "Not set";
const newDraft = () => ({
  campaignId: uuid(),
  name: "",
  audienceId: "",
  templateText: "",
  mediaId: null,
  budgetMicros: 0,
  deliveryNotBeforeMs: Date.now(),
  deliveryBeforeMs: Date.now() + 7 * 86400000,
});
const mediaData = (media) =>
  media &&
  ["image/png", "image/gif"].includes(media.mimeType) &&
  typeof media.dataBase64 === "string" &&
  media.dataBase64.length <= 682668
    ? `data:${media.mimeType};base64,${media.dataBase64}`
    : "";

export function createCampaigns(r) {
  const draftStore = createCampaignDraftStore(r.context?.() || {});
  const recipientRuntime = {
    ...r,
    changed: () => {
      persistDraft();
      r.changed();
    },
  };
  const recipients = createOrganizationContactBook(recipientRuntime, {
    mode: "selector",
    continueAction: () =>
      r.view().campaigns?.addingRecipients
        ? "recipient-batch-review"
        : r.context().resourceId === "new"
          ? "campaign-next"
          : null,
    continueLabel: () =>
      r.view().campaigns?.addingRecipients
        ? "Review additions"
        : "Continue to write message",
  });
  const state = () => (r.view().campaigns ||= {});
  const preparation = createCampaignPreparation(r, state);
  const volunteerPicker = createVolunteerPicker(r, state);
  const outcomes = createRecipientOutcomes(r, "queue-outcome");
  const additions = createRecipientBatches(r, state, recipients);
  function persistDraft() {
    const s = state();
    if (
      r.context?.().resourceId === "new" &&
      !s.campaign &&
      r.can("createCampaigns")
    )
      draftStore.save(s.draft, recipients.snapshot(), s.composeStep);
  }
  async function load(resource, section) {
    const s = state();
    if (resource && resource !== "new") {
      s.campaign = (await r.api(`/campaigns/${id(resource)}`)).campaign;
      if (section === "campaigns") preparation.observe(s.campaign);
      s.draft = { ...s.campaign };
      s.selected = new Set(list(s.campaign.assignedUserIds));
      if (s.campaign.mediaId)
        s.media = (
          await r.api(
            `${r.view().neutralApi ? `/campaigns/${id(s.campaign.campaignId)}` : ""}/media/${id(s.campaign.mediaId)}/content`,
          )
        ).media;
    } else if (resource === "new") {
      if (!s.draft && r.can("createCampaigns")) {
        const saved = draftStore.read();
        if (saved) {
          s.draft = saved.draft;
          s.composeStep = saved.composeStep;
          recipients.restore(saved.recipients);
        }
      }
      s.draft ||= newDraft();
      s.editing = true;
    } else {
      s.listView ||= "active";
      const result = await r.api(`/campaigns?view=${id(s.listView)}`);
      s.items = list(result.items);
      s.cursor = result.nextCursor;
    }
    if (resource && section === "campaigns" && r.can("createCampaigns")) {
      try {
        s.schedule = (await r.api("/delivery-schedule")).schedule;
      } catch (error) {
        if (r.view().neutralApi || ![404, 410].includes(error?.status))
          throw error;
        s.scheduleUnsupported = true;
      }
    }
    if (resource && resource !== "new" && section === "campaigns") {
      await additions.load();
    }
    if (
      resource === "new" &&
      section === "campaigns" &&
      r.can("createCampaigns")
    ) {
      const pendingSelection = r.takeContactCampaign?.();
      await recipients.load({ selection: pendingSelection });
      if (pendingSelection) s.composeStep = "message";
      else s.composeStep ||= "recipients";
      persistDraft();
    }
    if (
      resource &&
      resource !== "new" &&
      section === "team" &&
      r.can("createCampaigns")
    )
      await volunteerPicker.loadAssigned();
  }
  function campaignViews(s) {
    return `<div class="pt-actions" aria-label="Campaign views">${["active", "paused", "archived"].map((value) => button("campaigns-view", value[0].toUpperCase() + value.slice(1), { value, secondary: value !== (s.listView || "active"), disabled: r.busy() })).join("")}</div><p class="pt-muted">${s.listView === "archived" ? "Archived campaigns keep their messages, results and history." : s.listView === "paused" ? "Paused campaigns keep their history and can be resumed when ready." : "Active campaigns and drafts ready for your next step."}</p>`;
  }
  function campaignHours(s) {
    if (s.scheduleUnsupported) return "";
    const c = s.campaign;
    const editable =
      r.can("createCampaigns") &&
      ["draft", "prepared", "paused"].includes(c.status);
    return `<section class="pt-card"><h2>Daily sending hours</h2><p class="pt-muted">${e(scheduleSummary(c.effectiveDeliverySchedule || c.deliverySchedule || s.schedule))}${c.deliverySchedule ? " · Campaign hours" : " · Organization default"}</p>${editable ? `<form data-workspace-form="campaign-hours">${scheduleFields(s.schedule, s.hoursDraft === undefined ? c.deliverySchedule : s.hoursDraft, true)}<div class="pt-actions"><button type="submit" class="pt-btn"${r.busy() || s.schedule?.status !== "verified" ? " disabled" : ""}>Save campaign hours</button></div></form>` : c.status === "active" && r.can("createCampaigns") ? '<p class="pt-muted">Pause this campaign to change its daily hours.</p>' : ""}</section>`;
  }
  function listCards(s) {
    const empty =
      s.listView === "archived"
        ? "No archived campaigns on this page."
        : s.listView === "paused"
          ? "No paused campaigns on this page."
          : "Create your first campaign when your list is ready.";
    return `<section class="pt-card">${list(s.items).length ? s.items.map((c) => `<div class="pt-row"><div><strong>${e(c.name)}</strong><p class="pt-muted">${e(label(c.status))}${r.can("manageBilling") ? ` · ${money(c.settledMicros)} used` : ""}</p></div>${go("campaigns", "Open", c.campaignId, true)}</div>`).join("") : `<p class="pt-muted">${e(empty)}</p>`}${s.cursor ? button("campaigns-more", "Load more", { secondary: true }) : ""}</section>`;
  }
  function recipientStep() {
    const next = () =>
      button("campaign-next", "Next: Write message", {
        disabled: r.busy() || !recipients.hasSelection(),
      });
    return `<div class="pt-campaign-step"><header class="pt-campaign-step-nav"><div><span class="pt-eyebrow">STEP 1 OF 2</span><p>Choose your recipients.</p></div>${next()}</header>${recipients.render()}<footer class="pt-campaign-step-nav"><p class="pt-muted">You can write while recipients are prepared.</p>${next()}</footer></div>`;
  }
  function messageField(s, preview) {
    const fields = availablePersonalization(r.workspace?.()?.personalization);
    const error = s.personalizationInsertError || preview.error;
    return `<div class="pt-field pt-wide pt-message-field"><div class="pt-message-field-heading"><label for="campaign-message">Message</label>${fields.length ? `<select aria-label="Personalize message" data-workspace-personalize${r.busy() ? " disabled" : ""}><option value="">Personalize…</option>${fields.map((item) => `<option value="${e(item.name)}">${e(item.label)}</option>`).join("")}</select>` : ""}</div><textarea id="campaign-message" name="templateText" rows="6" maxlength="1600" required aria-invalid="${Boolean(error)}" aria-describedby="campaign-message-help${error ? " campaign-message-error" : ""}">${e(s.draft.templateText || "")}</textarea><p class="pt-muted" id="campaign-message-help">Include your organization name and “Reply STOP to opt out.”</p>${error ? `<p class="pt-message-error" id="campaign-message-error" role="alert">${e(error)}</p>` : ""}</div>`;
  }
  function draftForm(s) {
    const d = s.draft,
      preview = personalizationPreview(
        d.templateText || "",
        r.workspace?.()?.personalization,
      ),
      price = preview.error
        ? null
        : messagePrice(r.billing(), preview.example, !!d.mediaId),
      optInPrice = preview.error
        ? null
        : messagePrice(r.billing(), preview.example, !!d.mediaId, "opt_in"),
      image = mediaData(s.media),
      estimate = estimateContactCampaign(
        r.billing(),
        recipients.selection(),
        recipients.reviewed(),
        d.templateText || "",
        !!d.mediaId,
      ),
      newCampaign = r.context().resourceId === "new";
    return `${newCampaign ? `<div class="pt-campaign-step-nav"><div><span class="pt-eyebrow">STEP 2 OF 2</span><p>Write your message</p></div>${button("campaign-back", "Back to recipients", { secondary: true })}</div>${recipients.renderPreparation()}` : recipients.render()}<div class="pt-grid pt-grid--two"><form class="pt-card" data-workspace-form="campaign"><div class="pt-fields">${field("name", "Campaign name", d.name, { required: true })}${d.audienceId ? `<p class="pt-muted">This campaign keeps its saved recipient selection until you review a replacement below.</p>` : ""}${messageField(s, preview)}${r.can("manageBilling") ? field("budget", "Spending limit ($)", d.budgetMicros ? (d.budgetMicros / 1000000).toFixed(2) : "", { type: "number", required: true, extra: 'min="0.01" step="0.01"' }) : ""}</div>${r.can("manageBilling") ? `<section class="pt-campaign-estimate" aria-label="Campaign estimate"><div class="pt-row"><span>Reviewed eligible contacts</span><strong>${estimate.count === null ? "Review recipients first" : count(estimate.count)}</strong></div><div class="pt-row"><span>${preview.personalized && !d.mediaId ? "Example rate" : "Per message"}</span><strong>${price === null ? "Rate awaiting verification" : rateMoney(price)}</strong></div><div class="pt-row"><span>Estimated campaign total</span><strong>${estimate.personalized && !d.mediaId ? "Varies by recipient" : estimate.total === null ? "Awaiting review or verified rates" : money(estimate.total)}</strong></div><p class="pt-muted">${preview.personalized && !d.mediaId ? "Personalized messages vary in length. Final cost is checked for each recipient." : `Based on ${d.mediaId ? "one MMS" : `${estimate.segments} SMS segment(s)`} per eligible contact. Final totals may change after recipient checks.`}</p></section>` : ""}${details("When can volunteers send?", `<div class="pt-fields">${field("deliveryStart", "From", localInput(d.deliveryNotBeforeMs), { type: "datetime-local", required: true })}${field("deliveryEnd", "Until", localInput(d.deliveryBeforeMs), { type: "datetime-local", required: true })}</div><p class="pt-muted">Your local time. This sets the allowed window; it does not schedule automatic sends.</p>`)}${s.scheduleUnsupported ? "" : scheduleFields(s.schedule, d.deliverySchedule, true)}<div class="pt-field"><label for="workspace-media">GIF or image (optional)</label><input id="workspace-media" type="file" accept="image/png,image/gif,.png,.gif" data-workspace-change="campaign-media"><p class="pt-muted">PNG or GIF · up to 512 KB</p></div>${d.mediaId ? `<div class="pt-row"><span>${e(s.media?.providerReady === true ? "Image verified" : label(s.media?.state || "Saved attachment"))}</span>${button("media-remove", "Remove", { secondary: true })}</div>${r.can("canPrepareProviderMedia") && s.media?.providerReady !== true ? button("media-prepare", "Prepare attachment", { secondary: true, disabled: s.mediaNeedsRead || r.busy() || !["local_ready", "provider_uploaded_pending_verification"].includes(s.media?.state) }) : ""}${s.mediaNeedsRead ? button("media-refresh", "Refresh attachment", { secondary: true }) : ""}` : ""}<div class="pt-actions"><button class="pt-btn" type="submit"${r.busy() || preview.error || s.personalizationInsertError || (newCampaign && !recipients.reviewed()) ? " disabled" : ""}>Save campaign</button></div>${s.audienceCursor ? button("audiences-more", "Load more lists", { secondary: true }) : ""}</form><aside class="pt-card pt-workspace-preview"><div class="pt-eyebrow">${preview.personalized ? "EXAMPLE PREVIEW" : "MESSAGE PREVIEW"}</div><div class="pt-workspace-phone"><div class="pt-workspace-bubble">${image ? `<img src="${e(image)}" alt="Campaign attachment">` : ""}<p>${e(preview.error ? "Finish your message to see the example." : preview.example || "Your message will appear here.")}</p></div></div><div class="pt-row"><span>${d.mediaId ? "MMS" : preview.error ? "SMS" : `${preview.personalized ? "Example · " : ""}SMS · ${smsSegments(preview.example)} segment(s)`}</span>${r.can("manageBilling") ? `<strong>${price === null ? "Rate awaiting verification" : `${rateMoney(price)}${preview.personalized && !d.mediaId ? " example rate" : optInPrice === null ? " per message" : " standard"}`}</strong>` : ""}</div>${r.can("manageBilling") && optInPrice !== null ? `<div class="pt-row"><span>${preview.personalized && !d.mediaId ? "Opt-in example rate" : "Opt-in message"}</span><strong>${rateMoney(optInPrice)}</strong></div>` : ""}<p class="pt-muted">${preview.personalized ? "Example details only. Each recipient’s final message is reviewed before sending." : "Each person gets an individual send confirmation."}</p>${preview.fields.length ? details("If a detail is missing", `<p class="pt-muted">${preview.fields.map((item) => `${e(item.label)}: “${e(item.fallback)}”`).join(" · ")}</p>`) : ""}</aside></div>${newCampaign ? recipients.renderReview() : ""}`;
  }
  function preparationNotice(s) {
    const p = s.campaign?.preparation;
    if (!p || p.status === "complete") return "";
    const needsAttention = p.status === "needs_attention";
    const title = needsAttention
      ? "Recipient preparation needs attention"
      : p.status === "ready_to_finalize"
        ? "Checking the campaign message…"
        : "Preparing selected recipients…";
    const text =
      s.preparationPollError ||
      s.preparationRetryMessage ||
      (s.preparationPollingPaused
        ? "Automatic checks are paused. Your saved preparation is retained; check its status to continue."
        : needsAttention
          ? "Preparation stopped before it finished. Review the saved status below, then resume this approved selection when available."
          : "Your approved recipient selection is saved. This page checks progress automatically; you can return later without losing it.");
    return `${notice(title, text)}${p.errorCode ? reasons([p.errorCode]) : ""}<div class="pt-actions">${p.canResume === true && (needsAttention || s.preparationPollError || s.preparationPollingPaused || s.preparationCompletionAttempted || p.automaticResume !== true) ? button("campaign-preparation-resume", "Resume saved preparation", { disabled: r.busy() || !r.can("createCampaigns") }) : ""}${button("campaign-refresh", "Check preparation now", { secondary: true, disabled: r.busy() })}</div>`;
  }
  function campaignDetail(s) {
    const c = s.campaign,
      manage = r.can("createCampaigns"),
      image = mediaData(s.media);
    return `${preparationNotice(s)}${r.can("manageBilling") ? `<div class="pt-grid pt-grid--three">${stat("Campaign limit", money(c.budgetMicros))}${stat("Pending charges", money(c.reservedMicros))}${stat("Completed usage", money(c.settledMicros))}</div>` : ""}<div class="pt-grid pt-grid--two"><section class="pt-card"><div class="pt-row"><h2>Your message</h2>${manage && ["draft", "prepared"].includes(c.status) ? button("campaign-edit", "Edit", { secondary: true }) : ""}</div><div class="pt-workspace-bubble">${image ? `<img src="${e(image)}" alt="Saved campaign attachment">${s.media?.providerReady === true ? "<p>Image verified</p>" : ""}` : ""}<p>${e(c.templateText)}</p></div><p class="pt-muted">${dateText(c.deliveryNotBeforeMs)} – ${dateText(c.deliveryBeforeMs)}</p></section><section class="pt-card"><h2>Ready to begin?</h2><div class="pt-row"><span>Campaign</span><strong>${e(label(c.status))}</strong></div>${c.routingSummary ? `<div class="pt-row"><span>Opt-in contacts</span><strong>${count(c.routingSummary.optInCount)}</strong></div><div class="pt-row"><span>Standard contacts</span><strong>${count(c.routingSummary.standardCount)}</strong></div><div class="pt-row"><span>Excluded contacts</span><strong>${count(c.routingSummary.excludedCount)}</strong></div>${r.can("manageBilling") && Number.isSafeInteger(c.estimatedCostMicros) ? `<div class="pt-row"><span>Estimated campaign cost</span><strong>${money(c.estimatedCostMicros)}</strong></div>` : ""}` : ""}<div class="pt-row"><span>Assigned volunteers</span><strong>${count(list(c.assignedUserIds).length)}</strong></div>${reasons(list(c.blockedReasons).map((reason) => (reason === "content_not_prepared" || reason === "prompt_content_not_prepared" ? (s.preparingRecipients ? "Message will be checked when recipient preparation finishes" : "Message needs campaign preparation") : reason)))}<div class="pt-actions">${manage ? `${go("team", "Manage team", c.campaignId, true)}${["draft", "prepared"].includes(c.status) && !s.preparingRecipients ? button("transition-prepare", "Prepare selected recipients", { secondary: true }) : ""}${c.canActivate ? button("transition-activate", c.status === "paused" ? "Resume campaign" : "Open campaign") : ""}${c.status === "active" ? button("transition-pause", "Pause campaign", { secondary: true }) : ""}${c.status !== "archived" ? button("transition-archive", "Archive", { secondary: true }) : ""}` : ""}${c.canFetchQueue && r.can("manualQueue") ? go("send", "Start texting", c.campaignId) : ""}${go("results", "View results", c.campaignId, true)}</div>${c.status === "paused" ? notice("Sending paused", "This stops new sends from Polis. Any vendor-side work already accepted keeps its recorded status.") : ""}</section></div>`;
  }
  function team(s) {
    const c = s.campaign;
    if (!c)
      return (
        head("TEAM", "Choose a campaign", "Assignments belong to a campaign.") +
        listCards(s)
      );
    return (
      head(
        c.name,
        "A little teamwork",
        "Choose people who already have texting access.",
        go("campaigns", "Back", c.campaignId, true),
      ) +
      `<section class="pt-card">${volunteerPicker.render()}<div class="pt-actions">${button("assignments-save", "Save team", { disabled: r.busy() || s.assignmentsNeedRead || !r.can("createCampaigns") || c.status === "archived" })}${s.assignmentsNeedRead ? button("assignments-refresh", "Check saved assignments", { secondary: true, disabled: r.busy() }) + notice("Your selections are kept", "Check saved assignments before trying again.") : ""}</div><p class="pt-muted">Assignment does not grant organization permissions.</p></section>`
    );
  }
  function queue(s) {
    const c = s.campaign,
      q = s.queue,
      item = list(q?.items)[0],
      p = item?.preview,
      block = queueBlockExplanation(item),
      held = item && r.sendHeld(`queue:${c.campaignId}:${item.itemId}`),
      pending = item && s.pendingItemId === item.itemId,
      price =
        p &&
        messagePrice(
          r.billing(),
          p.message,
          !!(p.attachmentUrl || p.mediaId),
          item.stream,
        );
    if (!c) return head("TEXTING", "Choose a campaign") + listCards(s);
    return (
      head(
        c.name,
        "One person. One conversation.",
        "Take a moment to review, then send.",
        go("campaigns", "Leave session", c.campaignId, true) +
          (item
            ? outcomes.trigger({
                campaignId: c.campaignId,
                itemId: item.itemId,
              })
            : "") +
          (s.lastOutcomeTarget?.campaignId === c.campaignId
            ? outcomes.trigger(
                s.lastOutcomeTarget,
                "Record previous recipient outcome",
              )
            : ""),
      ) +
      (!q
        ? `<section class="pt-card"><h2>Your next conversation</h2><p class="pt-muted">Get your assigned recipients when you’re ready.</p>${button("queue-load", s.preparingAccess ? "Preparing your texting access…" : "Get my next messages", { disabled: !c.canFetchQueue || !r.can("manualQueue") || r.busy() })}${reasons(c.blockedReasons)}</section>`
        : item
          ? `<div class="pt-grid pt-grid--two"><section class="pt-card"><div class="pt-row"><div><h2>${e(p?.contactDisplayName || "Recipient")}</h2><p class="pt-muted">${e(p?.contactPhone || "Recipient unavailable")}</p></div><span class="pt-tag${block ? " pt-tag--attention" : ""}">${e(pending ? label(s.pendingAction) : held ? "Needs review" : block?.title || label(item.state))}</span></div><div class="pt-eyebrow">FINAL MESSAGE${item.stream ? ` · ${e(streamLabel(item.stream))}` : ""}</div><div class="pt-workspace-bubble">${p?.attachmentUrl || p?.mediaId ? ((item.stream === "opt_in" && p.mediaId ? protectedMediaData(s.queueMedia?.[p.mediaId]) : checkedUrl(p.attachmentUrl)) ? `<img data-workspace-queue-image="${e(item.itemId)}" src="${e(item.stream === "opt_in" && p.mediaId ? protectedMediaData(s.queueMedia?.[p.mediaId]) : checkedUrl(p.attachmentUrl))}" alt="Final message attachment" referrerpolicy="no-referrer">` : notice("Attachment unavailable")) : ""}<p>${e(p?.message || "Final text unavailable")}</p></div>${held && !pending ? notice("Delivery needs review", "Do not send again. Its charge stays reserved until the outcome is confirmed.") : ""}${block && !held && !pending ? notice(block.title, block.text) + (block.canRecheck ? button("queue-recheck", "Check recipient again", { secondary: true, disabled: r.busy() || !r.can("manualQueue") || !c.canFetchQueue }) : "") : ""}${reasons(item.blockedReasons)}${item.state === "lease_expired" ? notice("Recipient assignment expired", "This unsent recipient needs provider release before reassignment. It has not been returned automatically.") : item.expiresAtMs <= Date.now() ? notice("Preview expired", "Check the campaign status before continuing.") : ""}<div class="pt-row"><span>${p?.attachmentUrl || p?.mediaId ? "MMS" : "SMS"}${r.can("manageBilling") ? ` · ${price === null ? "Rate unavailable" : rateMoney(price)}` : ""}</span><div class="pt-actions">${item.state === "lease_expired" ? "" : button("queue-skip", "Skip recipient", { secondary: true, disabled: r.busy() || held || pending || !r.can("manualQueue") || !c.canFetchQueue || !queueCanSkip(item) })}${item.state === "lease_expired" ? "" : button("queue-confirm", pending && s.pendingAction === "sending" ? "Sending…" : `Send to ${p?.contactDisplayName || p?.contactPhone || "recipient"}`, { disabled: r.busy() || held || !queueCanConfirm(item, r.workspace(), r.billing(), s.imageLoaded === item.itemId) })}</div></div><p class="pt-muted">Sends this message to this person only.</p></section><aside class="pt-card"><div class="pt-eyebrow">YOUR SESSION</div>${stat("Messages confirmed this session", count(s.sent || 0))}${r.can("manageBilling") ? `<div class="pt-row"><span>Available funds</span><strong>${money(r.billing()?.availableMicros)}</strong></div>` : ""}${go("inbox", "Open inbox", "", true)}</aside></div>`
          : `<section class="pt-card"><h2>${q.state === "allocation_unknown" ? "Session needs review" : q.state === "lease_expired" ? "Recipient assignment expired" : "You’re caught up"}</h2><p class="pt-muted">${q.state === "allocation_unknown" ? "Your assigned messages could not be confirmed. An administrator must check the saved status." : q.state === "lease_expired" ? (q.automaticReclaim === true ? "Unsent contacts are available for assignment again. Get another group when you’re ready." : "This assignment needs provider release before those contacts can be reassigned.") : "Get another group when you’re ready."}</p>${q.state !== "allocation_unknown" ? button("queue-load", "Get more messages", { disabled: !c.canFetchQueue || r.busy() }) : ""}${reasons(q.blockedReasons)}</section>`)
    );
  }
  function render(section) {
    persistDraft();
    const s = state(),
      resource = r.context().resourceId;
    if (section === "team")
      return r.can("createCampaigns")
        ? team(s)
        : notice("Team access is restricted");
    if (section === "send") return queue(s) + outcomes.render();
    if (section === "results") {
      const c = s.campaign;
      if (!c)
        return (
          head(
            "RESULTS",
            "Campaign activity",
            "Choose a campaign to review its saved status.",
          ) + listCards(s)
        );
      return (
        head(
          c.name,
          "Every conversation counts",
          "Saved campaign activity",
          go("campaigns", "Back", c.campaignId, true),
        ) +
        `<div class="pt-grid pt-grid--three">${r.can("manageBilling") ? `${stat("Completed usage", money(c.settledMicros))}${stat("Pending charges", money(c.reservedMicros))}` : ""}${stat("Assigned volunteers", count(list(c.assignedUserIds).length))}</div><section class="pt-card"><div class="pt-row"><span>Campaign status</span><strong>${e(label(c.status))}</strong></div><p class="pt-muted">${r.can("manageBilling") ? "Pending charges stay reserved until vendor usage is verified. " : ""}Delivery and replies are shown in each conversation.</p>${go("inbox", "Open conversations", "", true)}${reasons(c.blockedReasons)}</section>`
      );
    }
    if (!resource)
      return (
        head(
          "CAMPAIGNS",
          "Make the next connection",
          "One message at a time.",
          r.can("createCampaigns") && r.can("manageBilling")
            ? go("campaigns", "New campaign", "new")
            : "",
        ) +
        campaignViews(s) +
        listCards(s)
      );
    if (s.addingRecipients) return additions.render();
    if (resource === "new" || s.editing)
      return r.can("createCampaigns") &&
        (resource !== "new" || r.can("manageBilling"))
        ? head(
            "CAMPAIGNS",
            resource === "new" ? "Start a conversation" : "Edit campaign",
            "Choose your contacts, then write your message.",
            go("campaigns", "Back", s.campaign?.campaignId || "", true),
          ) +
            (resource === "new" && s.composeStep !== "message"
              ? recipientStep(s)
              : draftForm(s))
        : notice("Campaign editing is restricted");
    return s.campaign
      ? head(
          "CAMPAIGNS",
          s.campaign.name,
          label(s.campaign.status),
          go("campaigns", "All campaigns", "", true),
        ) +
          campaignDetail(s) +
          additions.overview() +
          campaignHours(s)
      : "";
  }
  function readDraft(form) {
    const d = new FormData(form),
      cents = Math.round(Number(d.get("budget")) * 100);
    if (r.can("manageBilling") && (!Number.isSafeInteger(cents) || cents < 1))
      throw new Error("Enter a valid campaign spending limit.");
    return {
      name: String(d.get("name") || "").trim(),
      audienceId: state().draft?.audienceId || null,
      templateText: String(d.get("templateText") || ""),
      ...(r.can("manageBilling") ? { budgetMicros: cents * 10000 } : {}),
      deliveryNotBeforeMs: new Date(d.get("deliveryStart")).getTime(),
      deliveryBeforeMs: new Date(d.get("deliveryEnd")).getTime(),
      ...(state().scheduleUnsupported
        ? {}
        : { deliverySchedule: readSchedule(form, state().schedule, true) }),
    };
  }
  async function submit(kind, form) {
    if (await outcomes.submit(kind, form)) return true;
    if (await recipients.submit(kind, form)) return true;
    const s = state();
    if (kind === "campaign-hours") {
      const c = s.campaign;
      if (
        !r.can("createCampaigns") ||
        !["draft", "prepared", "paused"].includes(c?.status)
      )
        throw new Error(
          "Pause this campaign before changing its sending hours.",
        );
      const deliverySchedule = readSchedule(form, s.schedule, true);
      s.hoursDraft = deliverySchedule;
      s.campaign = (
        await r.api(
          `/campaigns/${id(c.campaignId)}/delivery-schedule`,
          {
            expectedRevision: c.revision,
            deliverySchedule,
          },
          "PATCH",
        )
      ).campaign;
      s.hoursDraft = undefined;
      s.draft = { ...s.campaign };
      r.toast("Campaign sending hours saved.");
      return true;
    }
    if (kind === "campaign") {
      if (!r.can("createCampaigns") || (!s.campaign && !r.can("manageBilling")))
        throw new Error("Campaign editing is restricted.");
      const draft = readDraft(form);
      if (!/\bSTOP\b/i.test(draft.templateText))
        throw new Error("Include “Reply STOP to opt out” in your message.");
      const preview = personalizationPreview(
        draft.templateText,
        r.workspace?.()?.personalization,
      );
      if (preview.error) throw new Error(preview.error);
      if (!s.campaign && recipients.hasSelection())
        draft.audienceId = await recipients.bindCampaign(s.draft.campaignId);
      if (!draft.audienceId)
        throw new Error("Choose and review campaign recipients first.");
      s.draft = { ...s.draft, ...draft };
      const saved = s.campaign;
      const result = await r.api(
        saved ? `/campaigns/${id(saved.campaignId)}` : "/campaigns",
        {
          ...draft,
          mediaId: s.draft.mediaId || null,
          ...(saved
            ? { expectedRevision: saved.revision }
            : { campaignId: s.draft.campaignId }),
        },
        saved ? "PATCH" : "POST",
      );
      s.campaign = result.campaign;
      draftStore.clear();
      s.editing = false;
      r.navigate("campaigns", result.campaign.campaignId);
      return true;
    }
    if (kind === "members") {
      await volunteerPicker.submit(form);
      return true;
    }
    return false;
  }
  async function action(name, value) {
    if (await outcomes.action(name, value)) return true;
    if (await additions.action(name, value)) return true;
    if (await volunteerPicker.action(name)) return true;
    if (await recipients.action(name, value)) return true;
    const s = state(),
      c = s.campaign;
    if (name === "campaign-refresh" || name === "campaign-preparation-resume") {
      await preparation.refresh({
        manual: true,
        resume: name === "campaign-preparation-resume",
      });
      return true;
    }
    if (name === "campaigns-view") {
      if (!["active", "paused", "archived"].includes(value)) return false;
      const result = await r.api(`/campaigns?view=${id(value)}`);
      s.items = list(result.items);
      s.cursor = result.nextCursor;
      s.listView = value;
      return true;
    }
    if (name === "campaigns-more") {
      const result = await r.api(
        `/campaigns?view=${id(s.listView || "active")}&cursor=${id(s.cursor)}`,
      );
      s.items.push(...list(result.items));
      s.cursor = result.nextCursor;
      return true;
    }
    if (name === "audiences-more") {
      const result = await r.api(`/audiences?cursor=${id(s.audienceCursor)}`);
      s.audiences.push(...list(result.audiences));
      s.audienceCursor = result.nextCursor;
      return true;
    }
    if (name === "campaign-next") {
      if (!r.can("createCampaigns") || !r.can("manageBilling"))
        throw new Error("Campaign creation is restricted.");
      if (!recipients.hasSelection())
        throw new Error("Choose at least one contact.");
      s.composeStep = "message";
      recipients.prepareInBackground();
      persistDraft();
      return true;
    }
    if (name === "campaign-back") {
      s.composeStep = "recipients";
      persistDraft();
      return true;
    }
    if (name === "campaign-edit") {
      if (!r.can("createCampaigns")) return true;
      await recipients.load();
      s.editing = true;
      return true;
    }
    if (name === "media-remove") {
      s.draft.mediaId = null;
      s.media = null;
      return true;
    }
    if (name === "media-prepare" || name === "media-refresh") {
      const write = name === "media-prepare";
      if (
        write &&
        (!r.can("canPrepareProviderMedia") ||
          s.mediaNeedsRead ||
          !["local_ready", "provider_uploaded_pending_verification"].includes(
            s.media?.state,
          ))
      )
        throw new Error("Refresh attachment status first.");
      if (
        write &&
        !window.confirm(
          "Prepare this attachment with your texting vendor? This sends no messages.",
        )
      )
        return true;
      s.mediaNeedsRead = true;
      const media = (
        await r.api(
          `/media/${id(s.draft.mediaId)}/${write ? "provider-sync" : "content"}`,
          write ? {} : undefined,
        )
      ).media;
      s.media = { ...s.media, ...media };
      s.mediaNeedsRead = false;
      return true;
    }
    if (name === "assignments-save") {
      if (
        !r.can("createCampaigns") ||
        s.assignmentsNeedRead ||
        c.status === "archived"
      )
        return true;
      try {
        await saveAssignmentChanges(r.api, c, s.selected, (saved) => {
          s.campaign = saved;
          volunteerPicker.invalidateAssigned();
        });
      } catch (error) {
        s.assignmentsNeedRead = true;
        throw error;
      }
      r.toast("Team saved");
      return true;
    }
    if (name === "assignments-refresh") {
      const previous = new Set(list(c.assignedUserIds)),
        add = [...s.selected].filter((userId) => !previous.has(userId)),
        remove = [...previous].filter((userId) => !s.selected.has(userId));
      const saved = (await r.api(`/campaigns/${id(c.campaignId)}`)).campaign;
      if (
        saved?.campaignId !== c.campaignId ||
        !Array.isArray(saved.assignedUserIds)
      )
        throw new Error("Campaign assignments could not be verified.");
      s.campaign = saved;
      volunteerPicker.invalidateAssigned();
      s.selected = new Set(
        [...saved.assignedUserIds, ...add].filter(
          (userId) => !remove.includes(userId),
        ),
      );
      s.assignmentsNeedRead = false;
      await volunteerPicker.loadAssigned();
      return true;
    }
    if (name.startsWith("transition-")) {
      const action = name.slice(11);
      if (
        !r.can("createCampaigns") ||
        !["prepare", "activate", "pause", "archive"].includes(action)
      )
        return false;
      const question = {
        prepare:
          "Prepare only this campaign’s reviewed recipients with your texting provider? Only the selected mobile phone numbers are transferred. This sends no messages.",
        activate:
          "Open this campaign for individual volunteer sends? No messages are sent by this action.",
        pause: "Pause new sends from this campaign in Polis?",
        archive: "Archive this campaign and stop new sends?",
      }[action];
      if (!window.confirm(question)) return true;
      try {
        s.campaign = (
          await r.api(`/campaigns/${id(c.campaignId)}/transition`, {
            expectedRevision: c.revision,
            action,
          })
        ).campaign;
        preparation.observe(s.campaign);
        await additions.load();
      } catch (error) {
        const code = error?.payload?.error || error?.code || error?.message;
        const uncertain = !error?.status || error.status >= 500;
        if (
          action !== "prepare" ||
          (code !== "prompt_contact_audience_preparing" && !uncertain)
        )
          throw error;
        await preparation.refresh({ manual: true });
        if (!s.campaign?.preparation && s.campaign?.status !== "prepared")
          throw error;
      }
      return true;
    }
    if (name === "queue-load" || name === "queue-recheck") {
      if (name === "queue-recheck") {
        const current = list(s.queue?.items)[0];
        if (
          !queueBlockExplanation(current)?.canRecheck ||
          s.pendingItemId ||
          r.sendHeld(`queue:${c?.campaignId}:${current?.itemId}`)
        )
          throw new Error("This recipient needs review before checking again.");
      }
      if (!r.can("manualQueue") || !c?.canFetchQueue)
        throw new Error("This campaign is not ready for texting.");
      if (name === "queue-load") await prepareTextingAccess(r, s, c.campaignId);
      s.queue = await r.api(`/campaigns/${id(c.campaignId)}/queue`, {});
      s.imageLoaded = null;
      s.queueMedia = {};
      for (const item of list(s.queue.items)) {
        const mediaId = item.stream === "opt_in" && item.preview?.mediaId;
        if (
          mediaId &&
          /^[A-Za-z0-9_-]{1,100}$/.test(mediaId) &&
          !s.queueMedia[mediaId]
        ) {
          const result = await r.api(
            `/campaigns/${id(c.campaignId)}/media/${id(mediaId)}/content`,
          );
          if (protectedMediaData(result.media))
            s.queueMedia[mediaId] = result.media;
        }
      }
      r.armExpiry(list(s.queue.items)[0]?.expiresAtMs);
      return true;
    }
    if (name === "queue-confirm" || name === "queue-skip") {
      const item = list(s.queue?.items)[0],
        key = `queue:${c.campaignId}:${item?.itemId}`;
      if (
        !item ||
        r.sendHeld(key) ||
        s.pendingItemId === item.itemId ||
        (name === "queue-confirm"
          ? !queueCanConfirm(
              item,
              r.workspace(),
              r.billing(),
              s.imageLoaded === item.itemId,
            )
          : !r.can("manualQueue") || !c.canFetchQueue || !queueCanSkip(item))
      )
        throw new Error(
          "This preview is not ready. Check its status before continuing.",
        );
      // The durable hold also fences an in-flight request. Only a completed
      // unknown/failed request should be presented as an uncertain outcome.
      const confirming = name === "queue-confirm";
      r.holdSend(key);
      s.pendingItemId = item.itemId;
      s.pendingAction = confirming ? "sending" : "skipping";
      r.changed();
      try {
        const result = (
          await r.api(
            `/campaigns/${id(c.campaignId)}/queue/${id(item.itemId)}/${confirming ? "confirm" : "skip"}`,
            confirming
              ? { humanConfirmation: item.humanConfirmation }
              : { actionId: uuid() },
          )
        ).result;
        if (!result || result.itemId !== item.itemId)
          throw new Error("The message outcome could not be verified.");
        if (
          ["accepted", "confirmed"].includes(result.state) ||
          (!confirming && result.state === "skipped")
        ) {
          r.releaseSend(key);
          s.lastOutcomeTarget = {
            campaignId: c.campaignId,
            itemId: item.itemId,
          };
          s.queue.items.shift();
          if (confirming) s.sent = (s.sent || 0) + 1;
          r.toast(confirming ? "Message accepted" : "Recipient skipped");
        } else if (
          result.state === "route_refresh_required" &&
          result.resendPermitted === false
        ) {
          item.state = result.state;
          r.toast(
            "Contact permission changed. Refresh your queue for a new preview.",
          );
        } else {
          item.state = result.state || "provider_outcome_unknown";
          r.toast("Message outcome needs review");
        }
      } finally {
        s.pendingItemId = null;
        s.pendingAction = null;
      }
      s.imageLoaded = null;
      await r.refreshSendStatus();
      r.armExpiry(list(s.queue.items)[0]?.expiresAtMs);
      return true;
    }
    return false;
  }
  function change(target) {
    if (outcomes.change(target)) return true;
    if (volunteerPicker.change(target)) return true;
    if (recipients.change(target)) return true;
    const s = state();
    if (target.dataset.workspacePersonalize !== undefined) {
      if (!target.value || !r.can("createCampaigns") || r.busy()) return false;
      const input = target
        .closest('[data-workspace-form="campaign"]')
        ?.querySelector('textarea[name="templateText"]');
      if (!input) return false;
      const inserted = insertPersonalization(
        input.value,
        target.value,
        input.selectionStart,
        input.selectionEnd,
        r.workspace?.()?.personalization,
        input.maxLength,
      );
      target.value = "";
      s.personalizationInsertError = inserted
        ? ""
        : "Make room in your message before adding a detail.";
      if (inserted) {
        s.draft.templateText = inserted.value;
        input.value = inserted.value;
        input.focus({ preventScroll: true });
        input.setSelectionRange(inserted.caret, inserted.caret);
      }
      return true;
    }
    const hoursForm = target.closest('[data-workspace-form="campaign-hours"]');
    if (hoursForm && target.name) {
      const values = new FormData(hoursForm);
      s.hoursDraft =
        values.get("dailyHoursMode") === "custom"
          ? {
              timeZone: s.schedule?.timeZone,
              startTime: values.get("sendingStart"),
              endTime: values.get("sendingEnd"),
            }
          : null;
      return true;
    }
    if (target.dataset.workspaceMember) {
      if (
        !r.can("createCampaigns") ||
        r.busy() ||
        s.assignmentsNeedRead ||
        s.campaign?.status === "archived"
      )
        return true;
      if (target.checked) s.selected.add(target.dataset.workspaceMember);
      else s.selected.delete(target.dataset.workspaceMember);
      return true;
    }
    const form = target.closest('[data-workspace-form="campaign"]');
    if (form && target.name) {
      if (target.name === "templateText") {
        if (
          s.draft.templateText === target.value &&
          !s.personalizationInsertError
        )
          return false;
        s.personalizationInsertError = "";
      }
      const values = new FormData(form);
      if (["name", "templateText"].includes(target.name))
        s.draft[target.name] = target.value;
      else if (target.name === "budget")
        s.draft.budgetMicros = Math.round(Number(target.value) * 100) * 10000;
      else if (target.name === "deliveryStart")
        s.draft.deliveryNotBeforeMs = new Date(target.value).getTime();
      else if (target.name === "deliveryEnd")
        s.draft.deliveryBeforeMs = new Date(target.value).getTime();
      else if (
        ["dailyHoursMode", "sendingStart", "sendingEnd"].includes(target.name)
      )
        s.draft.deliverySchedule =
          values.get("dailyHoursMode") === "custom"
            ? {
                timeZone: s.schedule?.timeZone,
                startTime: values.get("sendingStart"),
                endTime: values.get("sendingEnd"),
              }
            : null;
      return true;
    }
    return false;
  }
  async function mediaFile(file) {
    if (!file || !r.can("createCampaigns")) return;
    if (file.size < 1 || file.size > 512000 || !/\.(gif|png)$/i.test(file.name))
      throw new Error("Choose a PNG or GIF of 512 KB or less.");
    const s = state(),
      bytes = new Uint8Array(await file.arrayBuffer());
    r.guard();
    let text = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const attempt = {
      mediaId: uuid(),
      mimeType: /\.gif$/i.test(file.name) ? "image/gif" : "image/png",
      dataBase64: btoa(text),
      fileName: file.name,
    };
    const media = (await r.api("/media", attempt)).media;
    if (media?.mediaId !== attempt.mediaId || media.canUseInDraft !== true)
      throw new Error("Attachment preparation could not be confirmed.");
    s.media = { ...media, dataBase64: attempt.dataBase64 };
    s.draft.mediaId = media.mediaId;
  }
  return {
    load,
    render,
    submit,
    action,
    change,
    mediaFile,
    clearStoredDraft: () => draftStore.clear(),
    avatarError: volunteerPicker.avatarError,
    localAction: recipients.localAction,
    dispose() {
      preparation.dispose();
      volunteerPicker.dispose();
      recipients.dispose();
      outcomes.dispose();
      additions.dispose();
    },
  };
}
