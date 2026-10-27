import {
  escapeText as e,
  button,
  count,
  uuid,
  checkedUrl,
} from "./textingWorkspaceUi";
import {
  geocodeLabel,
  geocodeSelectionKey,
  geocodeTerminal,
} from "./geocodeUi";
import {
  createGeocodeSubscription,
  geocodePaymentUrl,
} from "./geocodeSubscription";

const base = "/geocoding/credits";
const policyDefault = {
  enabled: false,
  usePurchased: false,
  purchasedDailyCap: 0,
};
const destinationLabels = {
  contact_book: "Contact Book",
  field_work: "Field Work",
  territory_wizard: "territory wizard",
  doorknocker: "DoorKnocker",
};
export function geocodeQuoteSummary(q) {
  return (
    `${q.contactsNeedingGeocodes} of ${q.selectedContacts} selected contacts need geocodes for ${destinationLabels[q.destination] || "Contact Book"}. ` +
    `${q.uniqueAddresses} unique addresses: ${q.cachedAddresses} cached, ${q.externalAddresses} new lookups, ${q.acquiredAddresses} already acquired. Maximum ${q.maximumCredits} credits.`
  );
}

/** All state belongs to the containing authenticated workspace. Mutations are
 * explicit; opening, polling, restoring and preparing quotes never spend. */
export function createOrganizationGeocodeCredits({
  api,
  state,
  prefix,
  ownerKey = () => "",
  selectedIds,
  prepareSelection,
  selectionKey = selectedIds,
  busy,
  afterMutation = async () => {},
  continueDestination = null,
  navigate = (url) => window.location.assign(url),
}) {
  const get = () => {
    const container = state(),
      owner = ownerKey();
    if (container.geocodeCredits?.owner !== owner)
      container.geocodeCredits = { owner };
    return (container.geocodeCredits ||= { owner });
  };
  const request = api;
  api = async (...args) => {
    const owner = ownerKey(),
      container = state();
    const result = await request(...args);
    if (owner !== ownerKey() || container !== state())
      throw new Error(
        "The workspace changed. Open geocode credits in the current workspace.",
      );
    return result;
  };
  const purchaseStorageKey = () => `polis.geocode.checkout.v1:${ownerKey()}`;
  const b = (action, label, options = {}) =>
    button(`${prefix}-geocode-${action}`, label, {
      disabled: busy(),
      ...options,
    });
  const link = (url, label) =>
    `<a href="${e(checkedUrl(url))}" target="_blank" rel="noopener">${e(label)}</a>`;
  const date = (value) =>
    value ? new Date(value).toLocaleString() : "Not available";
  const draftAttr = `data-contact-change="${prefix}-geocode-draft"`;
  const load = async () => {
    const s = get();
    const previousStatus = s.status;
    s.status = await api(base);
    if (
      previousStatus?.paymentTermsVersion !== s.status.paymentTermsVersion &&
      s.formDraft
    )
      s.formDraft.paymentTerms = false;
    if (
      previousStatus?.rights?.manifest?.sha256 !==
        s.status.rights?.manifest?.sha256 &&
      s.formDraft
    )
      s.formDraft.authority = false;
    if (!s.status.enabled) {
      const owner = s.owner;
      state().geocodeCredits = { owner, status: s.status };
      return s.status;
    }
    if (!s.purchaseOperation && ownerKey()) {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(purchaseStorageKey()) || "null",
        );
        if (saved?.operation && Date.now() - saved.at < 86400000) {
          s.purchaseOperation = saved.operation;
          s.purchaseKey = saved.key;
          s.formDraft ||= {};
          s.formDraft.packId = saved.key?.split(":")[0];
          s.open = true;
        }
      } catch {
        /* Storage may be unavailable. Server purchase history still permits recovery. */
      }
    }
    if (s.open && s.job && !geocodeTerminal(s.job))
      s.job = (await api(`${base}/jobs/${encodeURIComponent(s.job.id)}`)).job;
    if (s.open && s.status.capabilities?.program)
      s.program = (await api(`${base}/program`)).program;
    if (s.open && s.purchaseOperation && s.status.permissions?.purchase)
      await page("purchases", `${base}/purchases`);
    await subscription.load();
    return s.status;
  };
  const subscription = createGeocodeSubscription({
    get,
    api,
    ownerKey,
    b,
    prefix,
    busy,
    navigate,
    refresh: load,
  });
  const invalidateQuote = () => {
    const s = get();
    s.quote = null;
    s.quoteSelection = null;
    s.operationId = null;
  };
  const ensureSelection = async (destination) => {
    const s = get(),
      key = geocodeSelectionKey(selectionKey());
    const selected = prepareSelection
      ? await prepareSelection()
      : { contactIds: selectedIds() };
    if (key !== geocodeSelectionKey(selectionKey()))
      throw new Error(
        "The selection changed. Review the current contacts again.",
      );
    s.quoteSelection = key;
    s.destination = destination;
    return selected;
  };
  const review = async (destination = "contact_book") => {
    const s = get();
    await load();
    const selection = await ensureSelection(destination);
    s.destinationSelection = selection.selectionId;
    s.destinationResult = null;
    s.destinationOperation = uuid();
    s.quote = (
      await api(`${base}/quotes`, {
        ...selection,
        destination,
        operationId: uuid(),
      })
    ).quote;
    s.operationId = uuid();
    s.open = true;
    s.job = null;
    s.outcomes = null;
    return s.quote;
  };
  const refreshMutation = async () => {
    await load();
    await afterMutation(get().job);
  };
  const destination = async (locatedOnly = false) => {
    const s = get();
    if (!s.destinationSelection)
      throw new Error("Review the complete contact selection again.");
    if (s.destinationResult && locatedOnly !== s.destinationLocatedOnly) {
      s.destinationResult = null;
      s.destinationOperation = uuid();
    }
    s.destinationLocatedOnly = locatedOnly;
    s.destinationResult = (
      await api(
        s.destinationResult
          ? `${base}/destinations/${encodeURIComponent(s.destinationResult.id)}/advance`
          : `${base}/destinations`,
        s.destinationResult
          ? {}
          : {
              operationId: s.destinationOperation,
              selectionId: s.destinationSelection,
              destination: s.destination,
              ...(s.job?.selectionId === s.destinationSelection &&
              s.job?.destination === s.destination
                ? { geocodeJobId: s.job.id }
                : {}),
              locatedOnly,
            },
      )
    ).destination;
    if (s.destinationResult?.status === "ready") {
      const operation =
        s.destinationResult.continuation?.operationId || s.destinationResult.id;
      if (s.continuedOperation !== operation) {
        await continueDestination(s.destinationResult);
        s.continuedOperation = operation;
      }
    }
  };
  const page = async (key, path, more = false) => {
    const s = get(),
      cursor = more ? s[`${key}Cursor`] : null;
    const result = await api(
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    s[key] = [
      ...(more ? s[key] || [] : []),
      ...(result.items || result.values || []),
    ];
    s[`${key}Cursor`] = result.nextCursor || null;
    if (key === "purchases" && s.purchaseOperation) {
      const recovered = s.purchases.find(
        (row) =>
          (row.purchaseId || row.operationId || row.id) === s.purchaseOperation,
      );
      if (
        recovered &&
        [
          "paid",
          "credited",
          "complete",
          "settled",
          "expired",
          "refunded",
          "funded",
        ].includes(recovered.status)
      ) {
        s.purchaseKey = null;
        s.purchaseOperation = null;
        try {
          sessionStorage.removeItem(purchaseStorageKey());
        } catch {
          /* Server receipts remain authoritative. */
        }
      }
    }
  };
  const policy = (key, label) => {
    const s = get(),
      value =
        s.settingsDraft?.[key] || s.status.settings?.[key] || policyDefault;
    return `<fieldset class="pt-card"><legend>${e(label)}</legend>
      <label><input ${draftAttr} type="checkbox" name="${key}_enabled"${value.enabled ? " checked" : ""}> Enable ${e(label.toLowerCase())}</label>
      <p>Uses included daily credits only. Purchased credits are available for manual geocoding.</p></fieldset>`;
  };
  const renderJob = (
    job,
  ) => `<p role="status">${count(job.completed)} of ${count(job.addresses)} addresses complete · ${count(job.charged)} credits used · ${count(job.review)} need review. ${e(geocodeLabel(job.status))}.</p>
    ${!geocodeTerminal(job) && get().status?.permissions?.spend ? b("advance", "Refresh processing", { disabled: busy() || get().status?.spendingEnabled === false || job.canAdvance === false }) : ""}
    ${!geocodeTerminal(job) && (get().status?.permissions?.spend || get().status?.permissions?.manage) ? b("cancel-job", "Cancel remaining addresses", { secondary: true }) : ""}
    ${b("outcomes", "Review address results", { secondary: true })}${job.review && get().status?.permissions?.spend ? b("requote", "Review costs for unresolved addresses", { secondary: true }) : ""}
    ${continueDestination && geocodeTerminal(job) && get().destination !== "contact_book" ? b("continue-destination", `Continue to ${destinationLabels[get().destination] || "destination"}`) : ""}`;
  return {
    load,
    review,
    invalidateQuote,
    capture(target) {
      if (subscription.capture(target)) return true;
      if (target.dataset?.contactChange !== `${prefix}-geocode-draft`)
        return false;
      const s = get(),
        form = target.closest("form");
      if (form?.dataset.workspaceForm?.endsWith("-settings")) {
        s.settingsDraft ||= structuredClone(s.status.settings);
        s.settingsDraftRevision ??= s.status.settings.revision;
        const [key, field] = target.name.split("_");
        s.settingsDraft[key] ||= { ...policyDefault };
        s.settingsDraft[key][
          {
            enabled: "enabled",
            paid: "usePurchased",
            cap: "purchasedDailyCap",
          }[field]
        ] = field === "cap" ? target.value : target.checked;
      } else {
        s.formDraft ||= {};
        s.formDraft[target.name] =
          target.type === "checkbox" ? target.checked : target.value;
      }
      return true;
    },
    render() {
      const s = get(),
        status = s.status;
      if (!status?.enabled) return "";
      if (s.quote && s.quoteSelection !== geocodeSelectionKey(selectionKey()))
        invalidateQuote();
      if (!s.open)
        return `<div class="pt-actions">${b("open", "Geocode credits", { secondary: true })}<span>${count(status.available)} available</span></div>`;
      const permissions = status.permissions || {},
        rights = status.rights || {},
        included = status.included || {},
        purchased = status.purchased || {},
        draft = s.formDraft || {};
      const q = s.quote,
        quoteReady = q && q.status !== "preparing";
      const canSpend =
        permissions.spend &&
        status.activated !== false &&
        rights.accepted &&
        !status.billingHold &&
        status.spendingEnabled !== false;
      return `<section class="pt-card" aria-label="Geocode credits"><div class="pt-row"><h2>Geocode credits</h2>${b("close", "Close", { secondary: true })}</div>
        <p><strong>${count(included.available)} included today</strong> · ${count(purchased.available)} purchased · ${count((included.reserved || 0) + (purchased.reserved || 0))} reserved · ${count(included.used)} included used today</p>
        <p>Included credits reset at 00:00 UTC (${e(date(status.resetAt))} locally) with no rollover. Purchased credits do not expire. Cached addresses cost 1 credit; new lookups cost 2. Previously acquired addresses cost 0.</p>
        ${status.activated === false ? '<p role="status">Awaiting organization activation by Polis. An authorized signatory can accept the geocoding agreement now; credit spending, automatic processing and checkout remain unavailable until activation.</p>' : ""}
        ${status.spendingEnabled === false ? '<p role="status">Credit spending is paused. Existing jobs and receipts remain available.</p>' : ""}${status.billingHold ? '<p role="alert">A payment adjustment needs administrator review before more credits can be spent.</p>' : ""}
        ${rights.accepted ? `<p>Geocoding agreement accepted${rights.acceptance?.acceptedAt ? ` on ${e(date(rights.acceptance.acceptedAt))}` : ""}. Future geocoding shares only the processed address and coordinates with Polis for permitted reuse. Other contact fields and historical processing are not included.</p>` : `<p>Organization acceptance is required before using credits or checking out.</p>${rights.available && permissions.sign ? `<form data-workspace-form="${prefix}-geocode-accept"><p>${e(status.legalEntityName || status.organizationName || "This organization")} · ${link(rights.manifest?.url, "Review the geocoding agreement")} · Version ${e(rights.manifest?.version)}</p><label class="pt-field"><span>Signer name</span><input ${draftAttr} name="signerName" value="${e(draft.signerName || "")}" maxlength="200" required></label><label class="pt-field"><span>Title</span><input ${draftAttr} name="signerTitle" value="${e(draft.signerTitle || "")}" maxlength="200" required></label><label><input ${draftAttr} name="authority" type="checkbox"${draft.authority ? " checked" : ""} required> I am authorized to bind this organization and accept the agreement for future geocoding of addresses and coordinates.</label><button class="pt-btn" type="submit"${busy() || !status.legalEntityRevision ? " disabled" : ""}>Accept for organization</button></form>` : "<p>An authorized organization signatory must accept the published geocoding agreement.</p>"}`}
        ${status.taxNotice ? `<p role="note">${e(status.taxNotice)}</p>` : ""}
        ${subscription.render()}
        ${permissions.spend ? b("quote", "Review selected addresses", { disabled: busy() || !canSpend }) : ""}
        ${q ? `<div class="note-box" role="status">${quoteReady ? `<p>${e(geocodeQuoteSummary(q))}</p><p>${count(q.alreadyLocated)} already located · ${count(q.review)} need address review. Only successfully saved geocodes are charged.</p>${q.maximumCredits > status.available ? "<p>Not enough credits for this complete selection. No work will be queued.</p>" : ""}${b("execute", `Spend up to ${q.maximumCredits} credits`, { disabled: busy() || !canSpend || !q.uniqueAddresses || Date.now() >= q.expiresAt || q.maximumCredits > status.available || (!q.providerReady && q.externalAddresses > 0) })}` : `<p>Preparing the complete selection. No credits are being spent.</p>${b("prepare-quote", "Continue cost review")}`}${b("cancel-quote", "Cancel review", { secondary: true })}</div>` : ""}
        ${s.job ? renderJob(s.job) : ""}
        ${continueDestination && s.destinationSelection && s.destination !== "contact_book" ? `<p>Continue only after the selected contacts are ready for ${e(destinationLabels[s.destination])}. Choosing located contacts excludes contacts without usable coordinates.</p>${b("continue-destination", "Check destination readiness", { secondary: true })}${b("located-destination", "Continue with located contacts only", { secondary: true })}${s.destinationResult ? `<p role="status">${e(geocodeLabel(s.destinationResult.status))} · ${count(s.destinationResult.eligibleContacts)} eligible · ${count(s.destinationResult.excludedContacts)} excluded. ${e(geocodeLabel(s.destinationResult.reason || ""))}</p>` : ""}` : ""}
        ${s.program ? `<p role="status">Automatic geocoding: ${e(geocodeLabel(s.program.status))}${s.program.nextWakeAt ? ` · Next check ${e(date(s.program.nextWakeAt))}` : ""} · ${count(s.program.reviewCount)} need review</p>` : ""}
        ${permissions.manage && rights.accepted ? `<form data-workspace-form="${prefix}-geocode-settings">${policy("automatic", "Automatic geocoding")}<p>Automatic processing remains enabled after catching up and processes new contacts later. It waits for the next daily allowance when included credits run out. Addresses needing review are held.</p>${status.automationAvailable === false ? '<p role="status">Automatic processing is paused by Polis. You can save a disabled setting.</p>' : ""}${s.settingsDraft && s.settingsDraftRevision !== status.settings?.revision ? '<p role="alert">Settings changed elsewhere. Your draft is preserved. Discard it to review current settings.</p>' : ""}<button class="pt-btn" type="submit"${busy() ? " disabled" : ""}>Save geocoding settings</button>${s.settingsDraft ? b("discard-settings", "Discard settings draft", { secondary: true }) : ""}</form>` : ""}
        ${permissions.purchase && status.purchasesEnabled ? `<form data-workspace-form="${prefix}-geocode-purchase"><label class="pt-field"><span>Credit pack</span><select ${draftAttr} name="packId" required>${(status.creditPacks || []).map((pack) => `<option value="${e(pack.id)}"${draft.packId === pack.id ? " selected" : ""}>${count(pack.credits)} credits · ${e(new Intl.NumberFormat("en-US", { style: "currency", currency: pack.currency }).format(pack.amountCents / 100))} before tax</option>`).join("")}</select></label><p>Purchased credits do not expire. Purchases are generally final, subject to required refunds and billing corrections. ${link(status.paymentTermsUrl, "Read payment terms")}</p><label><input ${draftAttr} name="paymentTerms" type="checkbox"${draft.paymentTerms ? " checked" : ""} required> I accept these payment terms for the organization.</label><button class="pt-btn" type="submit"${busy() || !rights.accepted || status.activated === false ? " disabled" : ""}>Continue to secure checkout</button></form>` : ""}
        ${s.purchaseOperation ? `<p role="status">A credit purchase is awaiting confirmation. Verify it before starting another purchase.</p>${b("purchase-refresh", "Verify pending credit purchase", { value: s.purchaseOperation, secondary: true })}` : ""}
        <div class="pt-actions">${b("refresh", "Refresh balance", { secondary: true })}${b("jobs", "Geocoding jobs", { secondary: true })}${permissions.manage || permissions.purchase ? b("history", "Credit history", { secondary: true }) + b("purchases", "Purchase history", { secondary: true }) : ""}${permissions.sign || permissions.manage ? b("acceptances", "Organization acceptance history", { secondary: true }) : ""}</div>
        ${s.jobs ? `<h3>Geocoding jobs</h3><ul>${s.jobs.map((job) => `<li>${e(date(job.createdAt))} · ${e(geocodeLabel(job.status))} · ${count(job.addresses)} addresses ${b("job", "Open job", { value: job.id, secondary: true })}</li>`).join("")}</ul>${s.jobsCursor ? b("jobs-more", "More jobs", { secondary: true }) : ""}` : ""}
        ${s.outcomes ? `<h3>Address results</h3><ul>${s.outcomes.map((row) => `<li>${e(row.displayName || row.address || "Selected contact")} · ${e(geocodeLabel(row.status))}${row.reason ? ` · ${e(geocodeLabel(row.reason))}` : ""}${row.credits != null ? ` · ${count(row.credits)} credits` : ""}${row.contactId ? button(`${prefix}-detail`, "Open contact", { value: row.contactId, secondary: true }) : ""}</li>`).join("")}</ul>${s.outcomesCursor ? b("outcomes-more", "More results", { secondary: true }) : ""}` : ""}
        ${s.history ? `<h3>Credit history</h3><ul>${s.history.map((row) => `<li>${e(date(row.at))} · ${e(geocodeLabel(row.type))}${row.included != null ? ` · ${row.included} included` : ""}${row.purchased != null ? ` · ${row.purchased} purchased` : ""}</li>`).join("")}</ul>${s.historyCursor ? b("history-more", "More credit history", { secondary: true }) : ""}` : ""}
        ${s.purchases ? `<h3>Purchases</h3><ul>${s.purchases.map((row) => `<li>${e(date(row.createdAt))} · ${count(row.credits)} credits · ${e(geocodeLabel(row.status))} ${b("purchase-refresh", "Verify purchase", { value: row.purchaseId || row.operationId, secondary: true })}</li>`).join("")}</ul>${s.purchasesCursor ? b("purchases-more", "More purchases", { secondary: true }) : ""}` : ""}
        ${s.acceptances ? `<h3>Acceptance history</h3><ul>${s.acceptances.map((row) => `<li>${e(date(row.acceptedAt))} · ${e(row.signerName)} · ${e(row.signerTitle)} · Version ${e(row.version)}</li>`).join("")}</ul>${s.acceptancesCursor ? b("acceptances-more", "More acceptances", { secondary: true }) : ""}` : ""}
      </section>`;
    },
    async action(name, value) {
      if (!name.startsWith(`${prefix}-geocode-`)) return false;
      const op = name.slice(`${prefix}-geocode-`.length),
        s = get();
      if (await subscription.action(op)) return true;
      if (op === "open") {
        s.open = true;
        await load();
        await page("jobs", `${base}/jobs`);
      } else if (op === "close") s.open = false;
      else if (op === "refresh") await load();
      else if (op === "cancel-quote") invalidateQuote();
      else if (op === "quote") await review();
      else if (op === "prepare-quote")
        s.quote = (
          await api(
            `${base}/quotes/${encodeURIComponent(s.quote.quoteId)}/advance`,
            {},
          )
        ).quote;
      else if (op === "execute") {
        if (
          !s.quote ||
          s.quoteSelection !== geocodeSelectionKey(selectionKey())
        ) {
          invalidateQuote();
          throw new Error(
            "The selection changed. Review its current address costs again.",
          );
        }
        if (Date.now() >= s.quote.expiresAt)
          throw new Error(
            "This quote expired. Review the selected addresses again.",
          );
        s.job = (
          await api(`${base}/executions`, {
            quoteId: s.quote.quoteId,
            operationId: s.operationId,
            maximumCredits: s.quote.maximumCredits,
          })
        ).job;
        invalidateQuote();
        s.job = (
          await api(`${base}/jobs/${encodeURIComponent(s.job.id)}/advance`, {})
        ).job;
        await refreshMutation();
      } else if (op === "advance") {
        s.job = (
          await api(`${base}/jobs/${encodeURIComponent(s.job.id)}/advance`, {})
        ).job;
        await refreshMutation();
      } else if (op === "cancel-job") {
        s.job = (
          await api(`${base}/jobs/${encodeURIComponent(s.job.id)}/cancel`, {})
        ).job;
        await refreshMutation();
      } else if (op === "job") {
        s.job = (await api(`${base}/jobs/${encodeURIComponent(value)}`)).job;
        s.outcomes = null;
        s.destinationSelection = s.job?.selectionId;
        s.destination = s.job?.destination || "contact_book";
        s.destinationOperation = uuid();
        s.destinationResult = null;
      } else if (op === "requote") {
        s.quote = (
          await api(`${base}/jobs/${encodeURIComponent(s.job.id)}/requote`, {})
        ).quote;
        s.quoteSelection = geocodeSelectionKey(selectionKey());
        s.operationId = uuid();
      } else if (op === "continue-destination") await destination(false);
      else if (op === "located-destination") await destination(true);
      else if (op === "discard-settings") {
        s.settingsDraft = null;
        s.settingsDraftRevision = null;
        await load();
      } else if (op.startsWith("jobs"))
        await page("jobs", `${base}/jobs`, op.endsWith("-more"));
      else if (op.startsWith("outcomes"))
        await page(
          "outcomes",
          `${base}/jobs/${encodeURIComponent(s.job.id)}/outcomes`,
          op.endsWith("-more"),
        );
      else if (op.startsWith("history"))
        await page("history", `${base}/ledger`, op.endsWith("-more"));
      else if (op.startsWith("acceptances"))
        await page("acceptances", `${base}/acceptances`, op.endsWith("-more"));
      else if (op.startsWith("purchases"))
        await page("purchases", `${base}/purchases`, op.endsWith("-more"));
      else if (op === "purchase-refresh") {
        await api(
          `${base}/purchases/${encodeURIComponent(value)}/reconcile`,
          {},
        );
        await page("purchases", `${base}/purchases`);
        await load();
      }
      return true;
    },
    async submit(name, form) {
      if (!name.startsWith(`${prefix}-geocode-`)) return false;
      if (await subscription.submit(name, form)) return true;
      const data = new FormData(form),
        s = get();
      if (name.endsWith("-purchase")) {
        if (
          !s.status?.enabled ||
          s.status.activated === false ||
          !s.status.permissions?.purchase ||
          !s.status.purchasesEnabled ||
          !s.status.rights?.accepted
        )
          throw new Error(
            "Current organization approval and purchasing permission are required before checkout.",
          );
        if (data.get("paymentTerms") !== "on")
          throw new Error("Accept the payment terms before continuing.");
        const key = `${data.get("packId")}:${s.status.paymentTermsVersion}`;
        if (s.purchaseOperation && s.purchaseKey !== key)
          throw new Error(
            "Verify the existing credit purchase before choosing another pack or payment agreement.",
          );
        if (s.purchaseKey !== key) {
          s.purchaseKey = key;
          s.purchaseOperation = uuid();
        }
        if (ownerKey()) {
          try {
            sessionStorage.setItem(
              purchaseStorageKey(),
              JSON.stringify({
                operation: s.purchaseOperation,
                key,
                at: Date.now(),
              }),
            );
          } catch {
            /* The in-memory operation still makes retries idempotent. */
          }
        }
        const result = await api(`${base}/checkout`, {
          packId: data.get("packId"),
          operationId: s.purchaseOperation,
          returnPath: window.location.pathname,
          acceptedPaymentTerms: s.status.paymentTermsVersion,
        });
        if (
          !/^https:\/\/checkout\.stripe\.com\//.test(result.checkoutUrl || "")
        ) {
          await page("purchases", `${base}/purchases`);
          throw new Error(
            "Check the existing purchase status before starting another checkout.",
          );
        }
        navigate(geocodePaymentUrl(result.checkoutUrl));
        return true;
      }
      if (name.endsWith("-accept")) {
        await api(`${base}/acceptance`, {
          signerName: data.get("signerName"),
          signerTitle: data.get("signerTitle"),
          authorityToBind: data.get("authority") === "on",
          source: "web",
          legalEntityRevision: s.status.legalEntityRevision,
          version: s.status.rights.manifest.version,
          sha256: s.status.rights.manifest.sha256,
        });
        s.formDraft = null;
      } else if (name.endsWith("-settings")) {
        if (
          data.get("automatic_enabled") === "on" &&
          (s.status.activated === false ||
            s.status.automationAvailable === false)
        )
          throw new Error(
            "Automatic geocoding is not currently available for this organization.",
          );
        const value = (key) => ({
          enabled: data.get(`${key}_enabled`) === "on",
          usePurchased: false,
          purchasedDailyCap: 0,
        });
        await api(
          `${base}/settings`,
          {
            expectedRevision:
              s.settingsDraftRevision ?? s.status.settings.revision,
            automatic: value("automatic"),
            field: {
              enabled: false,
              usePurchased: false,
              purchasedDailyCap: 0,
            },
          },
          "PATCH",
        );
        s.settingsDraft = null;
        s.settingsDraftRevision = null;
      }
      await load();
      return true;
    },
  };
}
