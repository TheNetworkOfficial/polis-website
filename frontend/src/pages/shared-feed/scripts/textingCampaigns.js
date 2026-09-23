import {
  escapeText as e,
  label,
  money,
  count,
  id,
  list,
  button,
  go,
  head,
  stat,
  field,
  select,
  textarea,
  notice,
  details,
  reasons,
  uuid,
  smsSegments,
  messagePrice,
  queueCanConfirm,
  checkedUrl,
} from "./textingWorkspaceUi";

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
  const state = () => (r.view().campaigns ||= {});
  async function load(resource, section) {
    const s = state();
    if (resource && resource !== "new") {
      s.campaign = (await r.api(`/campaigns/${id(resource)}`)).campaign;
      s.draft = { ...s.campaign };
      s.selected = new Set(list(s.campaign.assignedUserIds));
      if (s.campaign.mediaId)
        s.media = (
          await r.api(`/media/${id(s.campaign.mediaId)}/content`)
        ).media;
    } else if (resource === "new") {
      s.draft ||= newDraft();
      s.editing = true;
    } else {
      const result = await r.api("/campaigns");
      s.items = list(result.items);
      s.cursor = result.nextCursor;
    }
    if (
      (resource === "new" || (resource && section === "campaigns")) &&
      r.can("uploadImports")
    ) {
      const result = await r.api("/audiences");
      s.audiences = list(result.audiences);
      s.audienceCursor = result.nextCursor;
    }
  }
  function listCards(s) {
    return `<section class="pt-card">${list(s.items).length ? s.items.map((c) => `<div class="pt-row"><div><strong>${e(c.name)}</strong><p class="pt-muted">${e(label(c.status))} · ${money(c.settledMicros)} used</p></div>${go("campaigns", "Open", c.campaignId, true)}</div>`).join("") : `<h2>Start a conversation</h2><p class="pt-muted">Create your first campaign when your list is ready.</p>`}${s.cursor ? button("campaigns-more", "Load more", { secondary: true }) : ""}</section>`;
  }
  function draftForm(s) {
    const d = s.draft,
      price = messagePrice(r.billing(), d.templateText || "", !!d.mediaId),
      image = mediaData(s.media);
    return `<div class="pt-grid pt-grid--two"><form class="pt-card" data-workspace-form="campaign"><div class="pt-fields">${field("name", "Campaign name", d.name, { required: true })}${select("audienceId", "Contact list", [["", "Choose a reviewed list"], ...list(s.audiences).map((a) => [a.audienceId, `${a.name} · ${count(a.destinationCount)}`]), ...(d.audienceId && !list(s.audiences).some((a) => a.audienceId === d.audienceId) ? [[d.audienceId, "Saved audience"]] : [])], d.audienceId || "", true)}${textarea("templateText", "Message", d.templateText || "", true)}${field("budget", "Spending limit ($)", d.budgetMicros ? (d.budgetMicros / 1000000).toFixed(2) : "", { type: "number", required: true, extra: 'min="0.01" step="0.01"' })}</div><p class="pt-muted">Include your organization name and “Reply STOP to opt out.” Use the complete message without merge fields.</p>${details("When can volunteers send?", `<div class="pt-fields">${field("deliveryStart", "From", localInput(d.deliveryNotBeforeMs), { type: "datetime-local", required: true })}${field("deliveryEnd", "Until", localInput(d.deliveryBeforeMs), { type: "datetime-local", required: true })}</div><p class="pt-muted">Your local time. This sets the allowed window; it does not schedule automatic sends.</p>`)}<div class="pt-field"><label for="workspace-media">GIF or image (optional)</label><input id="workspace-media" type="file" accept="image/png,image/gif,.png,.gif" data-workspace-change="campaign-media"><p class="pt-muted">PNG or GIF · up to 512 KB</p></div>${d.mediaId ? `<div class="pt-row"><span>${e(label(s.media?.state || "Saved attachment"))}</span>${button("media-remove", "Remove", { secondary: true })}</div>${r.can("canPrepareProviderMedia") && s.media?.providerReady !== true ? button("media-prepare", "Prepare attachment", { secondary: true, disabled: s.mediaNeedsRead || r.busy() || !["local_ready", "provider_uploaded_pending_verification"].includes(s.media?.state) }) : ""}${s.mediaNeedsRead ? button("media-refresh", "Refresh attachment", { secondary: true }) : ""}` : ""}<div class="pt-actions"><button class="pt-btn" type="submit"${r.busy() ? " disabled" : ""}>Save campaign</button></div>${s.audienceCursor ? button("audiences-more", "Load more lists", { secondary: true }) : ""}</form><aside class="pt-card pt-workspace-preview"><div class="pt-eyebrow">MESSAGE PREVIEW</div><div class="pt-workspace-phone"><div class="pt-workspace-bubble">${image ? `<img src="${e(image)}" alt="Campaign attachment">` : ""}<p>${e(d.templateText || "Your message will appear here.")}</p></div></div><div class="pt-row"><span>${d.mediaId ? "MMS" : `SMS · ${smsSegments(d.templateText || "")} segment(s)`}</span><strong>${price === null ? "Rate awaiting verification" : `${money(price)} per message`}</strong></div><p class="pt-muted">Each person gets an individual send confirmation.</p></aside></div>`;
  }
  function campaignDetail(s) {
    const c = s.campaign,
      manage = r.can("createCampaigns"),
      image = mediaData(s.media);
    return `<div class="pt-grid pt-grid--three">${stat("Campaign limit", money(c.budgetMicros))}${stat("Pending charges", money(c.reservedMicros))}${stat("Completed usage", money(c.settledMicros))}</div><div class="pt-grid pt-grid--two"><section class="pt-card"><div class="pt-row"><h2>Your message</h2>${manage && ["draft", "prepared"].includes(c.status) ? button("campaign-edit", "Edit", { secondary: true }) : ""}</div><div class="pt-workspace-bubble">${image ? `<img src="${e(image)}" alt="Saved campaign attachment">` : ""}<p>${e(c.templateText)}</p></div><p class="pt-muted">${dateText(c.deliveryNotBeforeMs)} – ${dateText(c.deliveryBeforeMs)}</p></section><section class="pt-card"><h2>Ready to begin?</h2><div class="pt-row"><span>Campaign</span><strong>${e(label(c.status))}</strong></div><div class="pt-row"><span>Assigned volunteers</span><strong>${count(list(c.assignedUserIds).length)}</strong></div>${reasons(c.blockedReasons)}<div class="pt-actions">${manage ? `${go("team", "Manage team", c.campaignId, true)}${["draft", "prepared"].includes(c.status) ? button("transition-prepare", "Check readiness", { secondary: true }) : ""}${c.canActivate ? button("transition-activate", c.status === "paused" ? "Resume campaign" : "Open campaign") : ""}${c.status === "active" ? button("transition-pause", "Pause campaign", { secondary: true }) : ""}${c.status !== "archived" ? button("transition-archive", "Archive", { secondary: true }) : ""}` : ""}${c.canFetchQueue && r.can("manualQueue") ? go("send", "Start texting", c.campaignId) : ""}${go("results", "View results", c.campaignId, true)}</div>${c.status === "paused" ? notice("Sending paused", "This stops new sends from Polis. Any vendor-side work already accepted keeps its recorded status.") : ""}</section></div>`;
  }
  function team(s) {
    const c = s.campaign;
    if (!c)
      return (
        head("TEAM", "Choose a campaign", "Assignments belong to a campaign.") +
        listCards(s)
      );
    const selected = s.selected || new Set(),
      found = list(s.members),
      known = new Map(found.map((m) => [m.userId, m.displayName]));
    return (
      head(
        c.name,
        "A little teamwork",
        "Choose people who already have texting access.",
        go("campaigns", "Back", c.campaignId, true),
      ) +
      `<section class="pt-card"><form data-workspace-form="members" class="pt-fields">${field("query", "Find a teammate", s.query || "", { required: true, extra: 'minlength="2"' })}<div class="pt-actions"><button class="pt-btn pt-btn--secondary" type="submit">Search</button></div></form><p class="pt-muted">${selected.size} selected</p>${[...new Set([...selected, ...found.map((m) => m.userId)])].map((userId) => `<label class="pt-row pt-workspace-check"><span><strong>${e(known.get(userId) || "Assigned member")}</strong>${known.has(userId) ? "" : `<small class="pt-muted">${e(userId)}</small>`}</span><input type="checkbox" data-workspace-member="${e(userId)}"${selected.has(userId) ? " checked" : ""}></label>`).join("")}<div class="pt-actions">${button("assignments-save", "Save team", { disabled: r.busy() })}</div><p class="pt-muted">Assignment does not grant organization permissions.</p></section>`
    );
  }
  function queue(s) {
    const c = s.campaign,
      q = s.queue,
      item = list(q?.items)[0],
      p = item?.preview,
      held = item && r.sendHeld(`queue:${c.campaignId}:${item.itemId}`),
      price = p && messagePrice(r.billing(), p.message, !!p.attachmentUrl);
    if (!c) return head("TEXTING", "Choose a campaign") + listCards(s);
    return (
      head(
        c.name,
        "One person. One conversation.",
        "Take a moment to review, then send.",
        go("campaigns", "Leave session", c.campaignId, true),
      ) +
      (!q
        ? `<section class="pt-card"><h2>Your next conversation</h2><p class="pt-muted">Get your assigned recipients when you’re ready.</p>${button("queue-load", "Get my next messages", { disabled: !c.canFetchQueue || !r.can("manualQueue") || r.busy() })}${reasons(c.blockedReasons)}</section>`
        : item
          ? `<div class="pt-grid pt-grid--two"><section class="pt-card"><div class="pt-row"><div><h2>${e(p?.contactDisplayName || "Recipient")}</h2><p class="pt-muted">${e(p?.contactPhone || "Recipient unavailable")}</p></div><span class="pt-tag">${e(label(held ? "needs_review" : item.state))}</span></div><div class="pt-eyebrow">FINAL MESSAGE</div><div class="pt-workspace-bubble">${p?.attachmentUrl ? (checkedUrl(p.attachmentUrl) ? `<img data-workspace-queue-image="${e(item.itemId)}" src="${e(checkedUrl(p.attachmentUrl))}" alt="Final message attachment" referrerpolicy="no-referrer">` : notice("Attachment unavailable")) : ""}<p>${e(p?.message || "Final text unavailable")}</p></div>${held ? notice("Delivery needs review", "Do not send again. Its charge stays reserved until the outcome is confirmed.") : ""}${reasons(item.blockedReasons)}${item.expiresAtMs <= Date.now() ? notice("Preview expired", "Check the campaign status before continuing.") : ""}<div class="pt-row"><span>${p?.attachmentUrl ? "MMS" : "SMS"} · ${price === null ? "Rate unavailable" : money(price)}</span><div class="pt-actions">${button("queue-skip", "Skip recipient", { secondary: true, disabled: r.busy() || held || item.state !== "awaiting_confirmation" })}${button("queue-confirm", `Send to ${p?.contactDisplayName || p?.contactPhone || "recipient"}`, { disabled: r.busy() || held || !queueCanConfirm(item, r.workspace(), r.billing(), s.imageLoaded === item.itemId) })}</div></div><p class="pt-muted">Sends this message to this person only.</p></section><aside class="pt-card"><div class="pt-eyebrow">YOUR SESSION</div>${stat("Messages confirmed this session", count(s.sent || 0))}<div class="pt-row"><span>Available funds</span><strong>${money(r.billing()?.availableMicros)}</strong></div>${go("inbox", "Open inbox", "", true)}</aside></div>`
          : `<section class="pt-card"><h2>${q.state === "allocation_unknown" ? "Session needs review" : "You’re caught up"}</h2><p class="pt-muted">${q.state === "allocation_unknown" ? "Your assigned messages could not be confirmed. An administrator must check the saved status." : "Get another group when you’re ready."}</p>${q.state !== "allocation_unknown" ? button("queue-load", "Get more messages", { disabled: !c.canFetchQueue || r.busy() }) : ""}${reasons(q.blockedReasons)}</section>`)
    );
  }
  function render(section) {
    const s = state(),
      resource = r.context().resourceId;
    if (section === "team")
      return r.can("createCampaigns")
        ? team(s)
        : notice("Team access is restricted");
    if (section === "send") return queue(s);
    if (section === "results") {
      const c = s.campaign;
      if (!c)
        return (
          head(
            "RESULTS",
            "Campaign activity",
            "Choose a campaign to review its saved status and spending.",
          ) + listCards(s)
        );
      return (
        head(
          c.name,
          "Every conversation counts",
          "Saved campaign activity",
          go("campaigns", "Back", c.campaignId, true),
        ) +
        `<div class="pt-grid pt-grid--three">${stat("Completed usage", money(c.settledMicros))}${stat("Pending charges", money(c.reservedMicros))}${stat("Assigned volunteers", count(list(c.assignedUserIds).length))}</div><section class="pt-card"><div class="pt-row"><span>Campaign status</span><strong>${e(label(c.status))}</strong></div><p class="pt-muted">Pending charges stay reserved until vendor usage is verified. Delivery and replies are shown in each conversation.</p>${go("inbox", "Open conversations", "", true)}${reasons(c.blockedReasons)}</section>`
      );
    }
    if (!resource)
      return (
        head(
          "CAMPAIGNS",
          "Make the next connection",
          "One message at a time.",
          r.can("createCampaigns")
            ? go("campaigns", "New campaign", "new")
            : "",
        ) + listCards(s)
      );
    if (resource === "new" || s.editing)
      return r.can("createCampaigns")
        ? head(
            "CAMPAIGNS",
            resource === "new" ? "Start a conversation" : "Edit campaign",
            "A clear message. A focused list.",
            go("campaigns", "Back", s.campaign?.campaignId || "", true),
          ) + draftForm(s)
        : notice("Campaign editing is restricted");
    return s.campaign
      ? head(
          "CAMPAIGNS",
          s.campaign.name,
          label(s.campaign.status),
          go("campaigns", "All campaigns", "", true),
        ) + campaignDetail(s)
      : "";
  }
  function readDraft(form) {
    const d = new FormData(form),
      cents = Math.round(Number(d.get("budget")) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1)
      throw new Error("Enter a valid campaign spending limit.");
    return {
      name: String(d.get("name") || "").trim(),
      audienceId: d.get("audienceId") || null,
      templateText: String(d.get("templateText") || ""),
      budgetMicros: cents * 10000,
      deliveryNotBeforeMs: new Date(d.get("deliveryStart")).getTime(),
      deliveryBeforeMs: new Date(d.get("deliveryEnd")).getTime(),
    };
  }
  async function submit(kind, form) {
    const s = state();
    if (kind === "campaign") {
      if (!r.can("createCampaigns"))
        throw new Error("Campaign editing is restricted.");
      const draft = readDraft(form);
      if (
        !/\bSTOP\b/i.test(draft.templateText) ||
        /\{\{.*?\}\}|\[\[.*?\]\]/s.test(draft.templateText)
      )
        throw new Error(
          "Use the complete message with STOP instructions and no merge fields.",
        );
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
      s.editing = false;
      r.navigate("campaigns", result.campaign.campaignId);
      return true;
    }
    if (kind === "members") {
      s.query = String(new FormData(form).get("query") || "").trim();
      if (s.query.length < 2) throw new Error("Enter at least two characters.");
      s.members = list(
        (await r.api(`/members?query=${id(s.query)}&limit=20`)).members,
      );
      return true;
    }
    return false;
  }
  async function action(name) {
    const s = state(),
      c = s.campaign;
    if (name === "campaigns-more") {
      const result = await r.api(`/campaigns?cursor=${id(s.cursor)}`);
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
    if (name === "campaign-edit") {
      if (!r.can("createCampaigns")) return true;
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
      s.campaign = (
        await r.api(`/campaigns/${id(c.campaignId)}/assignments`, {
          expectedRevision: c.revision,
          userIds: [...s.selected],
        })
      ).campaign;
      r.toast("Team saved");
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
          "Check this saved campaign and its reviewed audience for manual texting?",
        activate:
          "Open this campaign for individual volunteer sends? No messages are sent by this action.",
        pause: "Pause new sends from this campaign in Polis?",
        archive: "Archive this campaign and stop new sends?",
      }[action];
      if (!window.confirm(question)) return true;
      s.campaign = (
        await r.api(`/campaigns/${id(c.campaignId)}/transition`, {
          expectedRevision: c.revision,
          action,
        })
      ).campaign;
      return true;
    }
    if (name === "queue-load") {
      if (!r.can("manualQueue") || !c?.canFetchQueue)
        throw new Error("This campaign is not ready for texting.");
      s.queue = await r.api(`/campaigns/${id(c.campaignId)}/queue`, {});
      s.imageLoaded = null;
      r.armExpiry(list(s.queue.items)[0]?.expiresAtMs);
      return true;
    }
    if (name === "queue-confirm" || name === "queue-skip") {
      const item = list(s.queue?.items)[0],
        key = `queue:${c.campaignId}:${item?.itemId}`;
      if (
        !item ||
        r.sendHeld(key) ||
        (name === "queue-confirm"
          ? !queueCanConfirm(
              item,
              r.workspace(),
              r.billing(),
              s.imageLoaded === item.itemId,
            )
          : !r.can("manualQueue") ||
            !c.canFetchQueue ||
            item.state !== "awaiting_confirmation")
      )
        throw new Error(
          "This preview is not ready. Check its status before continuing.",
        );
      // Hold before transport. Any ambiguous response keeps this exact item fenced; there is no automatic retry.
      r.holdSend(key);
      const confirming = name === "queue-confirm";
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
      if (["accepted", "confirmed"].includes(result.state)) {
        r.releaseSend(key);
        s.queue.items.shift();
        if (confirming) s.sent = (s.sent || 0) + 1;
        r.toast(confirming ? "Message accepted" : "Recipient skipped");
      } else {
        item.state = result.state || "provider_outcome_unknown";
        r.toast("Message outcome needs review");
      }
      s.imageLoaded = null;
      await r.refreshBilling();
      r.armExpiry(list(s.queue.items)[0]?.expiresAtMs);
      return true;
    }
    return false;
  }
  function change(target) {
    const s = state();
    if (target.dataset.workspaceMember) {
      if (target.checked) s.selected.add(target.dataset.workspaceMember);
      else s.selected.delete(target.dataset.workspaceMember);
      return true;
    }
    const form = target.closest('[data-workspace-form="campaign"]');
    if (form && target.name) {
      const values = new FormData(form);
      s.draft = {
        ...s.draft,
        name: values.get("name"),
        templateText: values.get("templateText"),
        audienceId: values.get("audienceId"),
        budgetMicros: Math.round(Number(values.get("budget")) * 100) * 10000,
        deliveryNotBeforeMs: new Date(values.get("deliveryStart")).getTime(),
        deliveryBeforeMs: new Date(values.get("deliveryEnd")).getTime(),
      };
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
  return { load, render, submit, action, change, mediaFile };
}
