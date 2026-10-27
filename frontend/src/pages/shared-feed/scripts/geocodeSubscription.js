import { escapeText as e, checkedUrl, count, uuid } from "./textingWorkspaceUi";

const base = "/geocoding/credits/subscription";
const money = (cents, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
const date = (value) =>
  value ? new Date(value).toLocaleString() : "Not available";
const label = (value) => String(value || "none").replaceAll("_", " ");
export function geocodePaymentUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    ![
      "checkout.stripe.com",
      "invoice.stripe.com",
      "billing.stripe.com",
    ].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error(
      "The payment link could not be verified. Refresh billing status before trying again.",
    );
  return url.href;
}

/** Billing intents belong to the authenticated organization and survive uncertain
 * responses. Only server reconciliation can decide whether payment succeeded. */
export function createGeocodeSubscription({
  get,
  api,
  ownerKey,
  b,
  prefix,
  busy,
  navigate,
  refresh,
}) {
  const storageKey = () => `polis.geocode.subscription.v1:${ownerKey()}`;
  const save = (operation) => {
    get().subscriptionOperation = operation;
    try {
      if (operation)
        sessionStorage.setItem(storageKey(), JSON.stringify(operation));
      else sessionStorage.removeItem(storageKey());
    } catch {
      /* The server retains the billing intent if browser storage is unavailable. */
    }
  };
  const requireAuthority = ({ payment = false } = {}) => {
    const s = get();
    if (!s.status?.enabled || !s.status.permissions?.subscriptionManage)
      throw new Error(
        "Only an organization owner or administrator can manage its plan.",
      );
    if (payment && (!s.status.rights?.accepted || s.status.activated === false))
      throw new Error(
        "Accept the current geocoding agreement before managing a plan.",
      );
    return s;
  };
  const resolveOperation = () => {
    const s = get(),
      operation = s.subscriptionOperation,
      sub = s.subscription;
    if (!operation || !sub) return;
    const receipt = sub.lastOperation;
    if (
      receipt?.operationId === operation.operationId &&
      ["rejected", "expired", "complete"].includes(receipt.status)
    ) {
      s.subscriptionNotice =
        receipt.status === "complete"
          ? "Billing request confirmed."
          : `Billing request ${receipt.status}. Review the current plan and payment terms before trying again.`;
      s.subscriptionPreview = null;
      save(null);
    } else if (!sub.pendingChange && sub.revision > operation.expectedRevision)
      save(null);
  };
  const load = async () => {
    const s = get();
    if (!s.status?.enabled || !s.status.capabilities?.subscription) {
      s.subscription = null;
      return;
    }
    const previous = s.subscription;
    s.subscription = (await api(base)).subscription;
    if (previous?.termsVersion !== s.subscription?.termsVersion) {
      if (s.subscriptionDraft) s.subscriptionDraft.subscriptionTerms = false;
      s.subscriptionPreview = null;
    }
    if (!s.subscriptionRestored) {
      s.subscriptionRestored = true;
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(storageKey()) || "null",
        );
        if (saved?.operationId && Date.now() - saved.at < 86400000)
          s.subscriptionOperation = saved;
      } catch {
        /* Server status remains available for recovery. */
      }
    }
    resolveOperation();
  };
  const pending = () =>
    Boolean(get().subscriptionOperation || get().subscription?.pendingChange);
  const send = async (operation) => {
    const s = requireAuthority({
      payment: ["checkout", "change", "resume"].includes(operation.kind),
    });
    save(operation);
    s.subscriptionNotice = null;
    const {
      kind,
      operationId,
      expectedRevision,
      planId,
      previewId,
      acceptedTermsVersion,
    } = operation;
    const result = await api(`${base}/${kind}`, {
      operationId,
      ...(kind === "checkout"
        ? { planId, acceptedTermsVersion, returnPath: window.location.pathname }
        : kind === "change"
          ? { previewId, expectedRevision, acceptedTermsVersion }
          : { expectedRevision }),
    });
    if (result.subscription) s.subscription = result.subscription;
    s.subscriptionPreview = null;
    s.subscriptionCancelReview = false;
    if (result.checkoutUrl) {
      navigate(geocodePaymentUrl(result.checkoutUrl));
      return;
    }
    if (
      ["scheduled", "complete", "completed", "active", "cancelled"].includes(
        result.status,
      )
    )
      save(null);
    await refresh();
  };
  return {
    load,
    capture(target) {
      if (
        target.dataset?.contactChange !== `${prefix}-geocode-subscription-draft`
      )
        return false;
      const s = get();
      s.subscriptionDraft ||= {};
      s.subscriptionDraft[target.name] =
        target.type === "checkbox" ? target.checked : target.value;
      s.subscriptionPreview = null;
      return true;
    },
    render() {
      const s = get(),
        sub = s.subscription;
      if (!sub) return "";
      const canManage = s.status.permissions?.subscriptionManage === true;
      const allowed =
        canManage &&
        s.status.rights?.accepted &&
        s.status.activated !== false &&
        sub.checkoutEnabled;
      const plan = sub.plans?.find((value) => value.id === sub.planId);
      const preview = s.subscriptionPreview;
      const draft = s.subscriptionDraft || {};
      const paid =
        sub.source === "stripe" &&
        ["active", "past_due", "unpaid"].includes(sub.status);
      const current =
        sub.source === "pilot"
          ? `90-day pilot · ${sub.status === "expired" ? "expired" : "ends"} ${date(sub.pilotEndsAt)}`
          : `${plan?.name || "No subscription"} · ${label(sub.status)}`;
      return `<section class="pt-card" aria-label="Geocoding subscription"><h3>Geocoding plan</h3><p role="status">${e(current)}</p><p>${count(sub.dailyCredits)} included credits per day${sub.paidThrough ? ` · Paid through ${e(date(sub.paidThrough))}` : ""}. Unused daily credits do not roll over. New daily allowances stop when the pilot or paid period ends, with no grace period. Credits already granted today remain until 00:00 UTC.</p>
      ${sub.pendingChange ? `<p role="status">${e(label(sub.pendingChange.kind))} ${e(label(sub.pendingChange.status))}${sub.pendingChange.planId ? ` · ${e(sub.plans?.find((value) => value.id === sub.pendingChange.planId)?.name || sub.pendingChange.planId)}` : ""}${sub.pendingChange.effectiveAt ? ` · Effective ${e(date(sub.pendingChange.effectiveAt))}` : ""}.</p>` : ""}
      ${sub.cancelAtPeriodEnd ? `<p>Your plan ends at the end of the paid period. It will not renew.</p>` : ""}
      ${s.subscriptionNotice ? `<p role="status">${e(s.subscriptionNotice)}</p>` : ""}
      ${
        canManage
          ? `${!s.status.rights?.accepted ? "<p>Accept the geocoding agreement before subscribing or changing plans.</p>" : ""}
      <div class="pt-workspace-table-wrap"><table><caption>Monthly plans</caption><thead><tr><th>Plan</th><th>Monthly price</th><th>Daily credits</th></tr></thead><tbody>${(sub.plans || []).map((value) => `<tr><th scope="row">${e(value.name)}</th><td>${e(money(value.amountCents, value.currency))}</td><td>${count(value.dailyCredits)}</td></tr>`).join("")}</tbody></table></div>
      <form data-workspace-form="${prefix}-geocode-subscription"><label class="pt-field"><span>Monthly geocoding plan</span><select data-contact-change="${prefix}-geocode-subscription-draft" name="planId"${pending() ? " disabled" : ""}>${(sub.plans || []).map((value) => `<option value="${e(value.id)}"${(draft.planId || sub.planId || sub.plans[0]?.id) === value.id ? " selected" : ""}>${e(value.name)} · ${e(money(value.amountCents, value.currency))}/month · ${count(value.dailyCredits)} credits/day</option>`).join("")}</select></label>
      <p>Plans renew monthly. Prices are before applicable tax. <a href="${e(checkedUrl(sub.termsUrl))}" target="_blank" rel="noopener">Read subscription payment terms</a></p><label><input type="checkbox" data-contact-change="${prefix}-geocode-subscription-draft" name="subscriptionTerms"${draft.subscriptionTerms ? " checked" : ""}${pending() ? " disabled" : ""}> I accept these subscription payment terms.</label><button class="pt-btn" type="submit"${!allowed || busy() || pending() ? " disabled" : ""}>${paid ? "Review plan change" : "Continue to subscription checkout"}</button></form>
      ${preview ? `<div class="note-box" role="status"><p>${e(label(preview.kind))}: ${e(sub.plans?.find((value) => value.id === preview.planId)?.name || preview.planId)}. ${preview.kind === "upgrade" ? `${e(money(preview.amountDueCents, preview.currency))} due now, prorated for the remaining period. The higher allowance starts only after payment is confirmed.` : `No charge now. The change takes effect ${e(date(preview.effectiveAt))}.`}</p><p>Review expires ${e(date(preview.expiresAt))}.</p>${b("subscription-confirm", preview.kind === "upgrade" ? "Confirm paid upgrade" : "Confirm period-end change", { disabled: busy() || !allowed || Date.now() >= preview.expiresAt })}${b("subscription-discard", "Discard plan change", { secondary: true })}</div>` : ""}
      ${paid && !sub.cancelAtPeriodEnd && !pending() ? b("subscription-cancel-review", "Cancel renewal", { secondary: true }) : ""}
      ${paid && (sub.cancelAtPeriodEnd || sub.pendingChange?.kind === "downgrade") ? b("subscription-resume-review", "Keep current plan renewing", { secondary: true, disabled: busy() || Boolean(s.subscriptionOperation) || !allowed }) : ""}
      ${s.subscriptionResumeReview ? `<p>Keep ${e(plan?.name || "your current plan")} renewing at its current monthly price and remove the scheduled change?</p>${b("subscription-resume-confirm", "Confirm continued renewal")}${b("subscription-discard", "Keep scheduled change", { secondary: true })}` : ""}
      ${s.subscriptionCancelReview ? `<p>Cancel renewal at ${e(date(sub.paidThrough))}? Your current paid period remains available.</p>${b("subscription-cancel-confirm", "Confirm cancellation at period end")}${b("subscription-discard", "Keep current plan", { secondary: true })}` : ""}
      ${s.subscriptionOperation ? `<p role="status">A billing request is awaiting confirmation. Verify its status before starting another request.</p>${b("subscription-retry", "Retry billing request", { secondary: true })}` : ""}
      ${b("subscription-refresh", "Verify subscription status", { secondary: true })}${sub.source === "stripe" ? b("subscription-portal", "Update payment method", { secondary: true }) : ""}${sub.pendingChange?.checkoutUrl ? b("subscription-payment", "Complete pending payment", { disabled: busy() || !s.status.rights?.accepted }) : ""}`
          : "<p>An organization owner or administrator manages this plan.</p>"
      }</section>`;
    },
    async submit(name, form) {
      if (name !== `${prefix}-geocode-subscription`) return false;
      const s = requireAuthority({ payment: true }),
        data = new FormData(form),
        sub = s.subscription;
      if (pending())
        throw new Error(
          "Verify the pending billing request before starting another.",
        );
      if (data.get("subscriptionTerms") !== "on")
        throw new Error(
          "Accept the subscription payment terms before continuing.",
        );
      if (!sub?.checkoutEnabled)
        throw new Error("Subscription changes are currently unavailable.");
      const planId = data.get("planId");
      if (!sub.plans?.some((plan) => plan.id === planId))
        throw new Error("Choose an available plan.");
      if (
        sub.source === "stripe" &&
        ["active", "past_due", "unpaid"].includes(sub.status)
      ) {
        if (planId === sub.planId)
          throw new Error("This is already your current plan.");
        const result = await api(`${base}/preview`, {
          planId,
          expectedRevision: sub.revision,
        });
        s.subscriptionPreview = result.preview || result;
        s.subscriptionPreviewTerms = sub.termsVersion;
      } else
        await send({
          kind: "checkout",
          operationId: uuid(),
          expectedRevision: sub.revision,
          planId,
          acceptedTermsVersion: sub.termsVersion,
          at: Date.now(),
        });
      return true;
    },
    async action(op) {
      if (!op.startsWith("subscription-")) return false;
      const s = requireAuthority(),
        sub = s.subscription;
      if (op === "subscription-discard") {
        s.subscriptionPreview = null;
        s.subscriptionCancelReview = false;
        s.subscriptionResumeReview = false;
      } else if (op === "subscription-refresh") {
        const result = await api(
          `${base}/reconcile`,
          s.subscriptionOperation
            ? { operationId: s.subscriptionOperation.operationId }
            : {},
        );
        s.subscription = result.subscription;
        resolveOperation();
        await refresh();
      } else if (op === "subscription-retry") {
        if (s.subscriptionOperation) await send(s.subscriptionOperation);
      } else if (op === "subscription-payment") {
        requireAuthority({ payment: true });
        navigate(geocodePaymentUrl(sub.pendingChange.checkoutUrl));
      } else if (op === "subscription-portal") {
        s.subscriptionPortalOperation ||= uuid();
        const result = await api(`${base}/portal`, {
          operationId: s.subscriptionPortalOperation,
          returnPath: window.location.pathname,
        });
        navigate(geocodePaymentUrl(result.checkoutUrl));
      } else if (op === "subscription-resume-review")
        s.subscriptionResumeReview = true;
      else if (op === "subscription-resume-confirm") {
        if (!s.subscriptionResumeReview || s.subscriptionOperation)
          throw new Error(
            "Review the scheduled change before resuming renewal.",
          );
        await send({
          kind: "resume",
          operationId: uuid(),
          expectedRevision: sub.revision,
          at: Date.now(),
        });
        s.subscriptionResumeReview = false;
      } else if (op === "subscription-cancel-review")
        s.subscriptionCancelReview = true;
      else if (op === "subscription-cancel-confirm") {
        if (!s.subscriptionCancelReview || pending())
          throw new Error("Review the current subscription before cancelling.");
        await send({
          kind: "cancel",
          operationId: uuid(),
          expectedRevision: sub.revision,
          at: Date.now(),
        });
      } else if (op === "subscription-confirm") {
        const preview = s.subscriptionPreview;
        if (
          !preview ||
          Date.now() >= preview.expiresAt ||
          preview.expectedRevision !== sub.revision ||
          s.subscriptionPreviewTerms !== sub.termsVersion ||
          pending()
        )
          throw new Error(
            "This plan review expired or changed. Review the plan again.",
          );
        await send({
          kind: "change",
          operationId: uuid(),
          previewId: preview.previewId,
          expectedRevision: preview.expectedRevision,
          acceptedTermsVersion: sub.termsVersion,
          at: Date.now(),
        });
      }
      return true;
    },
  };
}
