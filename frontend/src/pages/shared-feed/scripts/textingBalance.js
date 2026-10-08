import { rateMoney } from "./textingWorkspaceUi";
import { renderTextingRenewals } from "./textingRenewals";
import {
  customFundingConfig,
  customFundingQuote,
  fundingRetryAmount,
} from "./textingFundingAmount";
import "../css/texting-balance.css";

const TERMINAL = new Set([
  "funded",
  "failed",
  "canceled",
  "expired",
  "refunded",
  "disputed",
  "reversed",
]);
const money = (value, divisor = 100) =>
  !Number.isSafeInteger(value)
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: divisor === 1000000 ? 4 : 2,
      }).format(value / divisor);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

function safeUrl(value, hosts = null) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!hosts || hosts.includes(url.hostname))
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function purchaseLabel(status) {
  return (
    {
      funded: "Funds added",
      failed: "Payment failed",
      canceled: "Checkout canceled",
      expired: "Checkout expired",
      refunded: "Payment refunded",
      disputed: "Payment under review",
      reversed: "Payment reversed",
    }[status] || "Payment processing"
  );
}

function requireBillingAdmin(billing) {
  if (billing?.canManageBilling !== true) {
    const error = new Error("billing_access_denied");
    error.status = 403;
    throw error;
  }
  if (billing.currency !== "usd") throw new Error("billing_unavailable");
  return billing;
}

export function billingContactError(error) {
  const code =
    error?.errorCode || error?.code || error?.payload?.error || error?.message;
  return (
    {
      billing_contact_invalid:
        "Enter a name, valid email, and a US phone number or leave phone blank.",
      billing_contact_code_invalid:
        "That code did not match. Enter the 8-digit code from your email.",
      billing_contact_code_expired: "This code expired. Request a new code.",
      billing_contact_code_unavailable: "Request a new code to continue.",
      billing_contact_changed:
        "Billing details changed. Refresh the details before editing.",
      billing_contact_rate_limited:
        "Please wait a minute before requesting another code.",
      billing_contact_update_in_progress:
        "An update is in progress. Refresh the details shortly.",
      billing_contact_reauthentication_required:
        "For security, sign out and sign in again, then return to Billing details.",
      billing_contact_recovery_required:
        "Contact payment support to finish the previous update.",
    }[code] ||
    "The update could not be confirmed. Refresh the details before trying again."
  );
}

/** Organization-scoped view; server confirmation is the only source of funding state. */
export function createTextingBalancePage({ request, context, changed }) {
  let view = {};
  let timer;
  let sequence = 0;
  const retryKeys = new Map();
  const identity = () => {
    const current = context();
    return current?.organizationId && current?.userId
      ? `${current.userId}:${current.organizationId}`
      : "";
  };
  const current = (key, version) =>
    identity() === key && view.key === key && sequence === version;
  const renderChanged = changed;
  changed = () => {
    const input = document.activeElement;
    const focused = input?.matches("[data-texting-custom-amount]");
    const selection = focused
      ? [input.selectionStart, input.selectionEnd]
      : null;
    const key = view.key;
    renderChanged();
    if (focused)
      requestAnimationFrame(() => {
        if (identity() !== key || view.key !== key) return;
        const replacement = document.querySelector(
          "[data-texting-custom-amount]",
        );
        if (replacement && document.activeElement === document.body) {
          replacement.focus();
          replacement.setSelectionRange(...selection);
        }
      });
  };
  const transport = request;
  request = async (...args) => {
    const key = identity(),
      version = sequence;
    try {
      return await transport(...args);
    } catch (error) {
      if (current(key, version) && [401, 403].includes(error?.status)) {
        view.accessDenied = true;
        view.billing = null;
        view.billingContact = null;
        view.contactFields = {};
        view.contactCode = "";
      }
      throw error;
    }
  };
  const path = (organizationId, suffix) =>
    `/api/text-banking/${view.neutralApi ? "workspaces" : "prompt/scopes"}/${encodeURIComponent(`coalition:${organizationId}`)}/billing/${suffix}`;

  function reset() {
    clearTimeout(timer);
    sequence += 1;
    view = {};
  }

  async function history({ append = false } = {}) {
    if (
      identity() !== view.key ||
      !view.billing?.canManageBilling ||
      view.historyLoading
    )
      return;
    const key = view.key;
    const version = sequence;
    view.historyLoading = true;
    view.historyError = "";
    changed();
    try {
      const cursor =
        append && view.nextCursor
          ? `&cursor=${encodeURIComponent(view.nextCursor)}`
          : "";
      const result = await request(
        path(context().organizationId, `transactions?limit=20${cursor}`),
        { auth: true },
      );
      if (!current(key, version)) return;
      view.transactions = [
        ...(append ? view.transactions || [] : []),
        ...(result.transactions || []),
      ];
      view.nextCursor = result.nextCursor || "";
    } catch (error) {
      if (!current(key, version)) return;
      if (error.status === 401 || error.status === 403) {
        view.billing = null;
        view.transactions = [];
        view.error =
          "Your access has changed. Refresh to check your organization permissions.";
      } else
        view.historyError =
          "Purchase history could not be loaded. Please refresh.";
    } finally {
      if (current(key, version)) {
        view.historyLoading = false;
        changed();
      }
    }
  }

  async function checkPurchase() {
    if (identity() !== view.key) return;
    if (!view.purchaseId || !view.billing?.canManageBilling || view.checking)
      return;
    clearTimeout(timer);
    const key = view.key;
    const version = sequence;
    const organizationId = context().organizationId;
    view.checking = true;
    try {
      const result = await request(
        path(
          organizationId,
          `purchases/${encodeURIComponent(view.purchaseId)}`,
        ),
        { auth: true },
      );
      if (!current(key, version)) return;
      view.purchase = result.purchase;
      view.purchaseError = "";
      // Neither a return URL nor a completed Checkout page changes this balance.
      const summary = await request(path(organizationId, "summary"), {
        auth: true,
      });
      if (!current(key, version)) return;
      view.billing = requireBillingAdmin(summary.billing);
      if (!view.billing?.canManageBilling) {
        view.purchase = null;
        view.purchaseId = "";
        view.transactions = [];
        return;
      }
      if (TERMINAL.has(view.purchase?.status)) {
        view.section = "balance";
        const amountKey = fundingRetryAmount(view.purchase);
        const revision = view.purchase.billingContactRevision || 0;
        const storageKey = `polis.textingCheckout.${view.key}.${amountKey}${revision ? `.contact${revision}` : ""}`;
        retryKeys.delete(storageKey);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Storage can be unavailable in privacy mode. */
        }
        await history();
      } else if (++view.pollCount < 10) timer = setTimeout(checkPurchase, 3000);
    } catch (error) {
      if (!current(key, version)) return;
      view.purchaseError =
        error.status === 403 || error.status === 404
          ? "This purchase is unavailable for your organization."
          : "Payment status could not be confirmed. Refresh before starting another purchase.";
      if (error.status === 401 || error.status === 403) {
        view.billing = null;
        view.transactions = [];
        view.purchase = null;
      }
    } finally {
      if (current(key, version)) {
        view.checking = false;
        changed();
      }
    }
  }

  async function load() {
    clearTimeout(timer);
    const key = identity();
    if (!key) {
      reset();
      return;
    }
    const version = ++sequence;
    const organizationId = context().organizationId;
    const query = new URL(window.location.href).searchParams;
    const purchaseId = query.get("purchase") || "";
    view = {
      key,
      loading: true,
      billing: null,
      transactions: [],
      pollCount: 0,
      purchaseId: /^[A-Za-z0-9_-]{1,200}$/.test(purchaseId) ? purchaseId : "",
      canceledReturn: query.get("checkout") === "canceled",
      section:
        query.get("section") === "billing-details"
          ? "billing-details"
          : "balance",
    };
    changed();
    try {
      const scope = `coalition:${organizationId}`;
      const workspace = await request(
        `/api/text-banking/prompt/scopes/${encodeURIComponent(scope)}/workspace`,
        { auth: true },
      ).catch((error) => {
        if ([401, 403].includes(error?.status)) throw error;
        return null;
      });
      if (!current(key, version)) return;
      view.readContactBook =
        workspace?.workspace?.scopeKey === scope &&
        workspace?.workspace?.capabilities?.readContactBook === true;
      view.authorizationReady = workspace?.workspace?.scopeKey === scope;
      view.neutralApi =
        workspace?.workspace?.scopeKey === scope &&
        workspace?.workspace?.capabilities?.neutralWorkspaceApi === true;
      const result = await request(path(organizationId, "summary"), {
        auth: true,
      });
      if (!current(key, version)) return;
      view.billing = requireBillingAdmin(result.billing);
      if (view.billing.canManageBilling) {
        await history();
        await checkPurchase();
        if (
          view.section === "billing-details" &&
          view.billing.canManageBillingContact
        )
          await loadBillingContact();
      }
    } catch (error) {
      if (!current(key, version)) return;
      view.error =
        error.status === 401 || error.status === 403
          ? "You do not have access to this organization's texting balance."
          : "Texting balance is unavailable. Please refresh or contact support.";
      view.billing = null;
    } finally {
      if (current(key, version)) {
        view.loading = false;
        changed();
      }
    }
  }

  /** Recheck current permissions and funds without clearing an in-progress review. */
  async function refresh() {
    if (
      identity() !== view.key ||
      view.loading ||
      view.refreshing ||
      view.saving
    )
      return;
    const key = view.key;
    const version = sequence;
    view.refreshing = true;
    try {
      const result = await request(path(context().organizationId, "summary"), {
        auth: true,
      });
      if (!current(key, version)) return;
      requireBillingAdmin(result.billing);
      if (approvalDetails(view.billing) !== approvalDetails(result.billing)) {
        view.acceptedTerms = false;
      }
      view.billing = result.billing;
      if (
        view.selectedPack === "custom" &&
        !customFundingConfig(view.billing.customAmount)
      ) {
        view.selectedPack = "";
        view.customTouched = false;
      }
      view.error = "";
      if (!view.billing.canManageBilling) {
        view.purchase = null;
        view.purchaseId = "";
        view.transactions = [];
        view.section = "balance";
      } else {
        if (!view.billing.canPurchase && view.section === "add-funds")
          view.section = "balance";
        if (view.purchaseId) await checkPurchase();
      }
    } catch (error) {
      if (!current(key, version)) return;
      view.error =
        error.status === 401 || error.status === 403
          ? "You do not have access to this organization's texting balance."
          : "The balance could not be refreshed. Refresh before starting a purchase.";
      if (error.status === 401 || error.status === 403) {
        view.billing = null;
        view.transactions = [];
        view.purchase = null;
        view.acceptedTerms = false;
      }
    } finally {
      if (current(key, version)) {
        view.refreshing = false;
        changed();
      }
    }
  }

  function selectedQuote(billing = view.billing) {
    return view.selectedPack === "custom"
      ? customFundingQuote(view.customAmount, billing?.customAmount).quote
      : billing?.packs?.find((item) => item.id === view.selectedPack);
  }

  function approvalDetails(billing) {
    return JSON.stringify({
      quote: selectedQuote(billing),
      customAmount:
        view.selectedPack === "custom" ? billing?.customAmount : null,
      terms: billing?.terms,
    });
  }

  /** Retain a retry key across uncertain HTTP results and page refreshes. */
  function checkoutKey(packId) {
    const revision = view.billing?.billingContactRevision ?? 0;
    const storageKey = `polis.textingCheckout.${view.key}.${packId}${revision ? `.contact${revision}` : ""}`;
    if (retryKeys.has(storageKey)) return retryKeys.get(storageKey);
    const key = crypto.randomUUID();
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        retryKeys.set(storageKey, stored);
        return stored;
      }
      retryKeys.set(storageKey, key);
      sessionStorage.setItem(storageKey, key);
      return key;
    } catch {
      retryKeys.set(storageKey, key);
      return key;
    }
  }

  async function loadBillingContact() {
    if (
      identity() !== view.key ||
      !view.billing?.canManageBillingContact ||
      view.contactSaving
    )
      return;
    const key = view.key,
      version = sequence;
    view.contactLoading = true;
    view.contactError = "";
    changed();
    try {
      const result = await request(path(context().organizationId, "contact"), {
        auth: true,
      });
      if (!current(key, version)) return;
      view.billingContact = result.contact;
      view.contactFields = {
        ...(result.contact.pendingChange?.details || result.contact.details),
      };
      view.contactCode = "";
      view.contactOperationId = "";
    } catch (error) {
      if (current(key, version)) view.contactError = billingContactError(error);
    } finally {
      if (current(key, version)) {
        view.contactLoading = false;
        changed();
      }
    }
  }

  async function saveBillingContact(action) {
    if (
      identity() !== view.key ||
      !view.billing?.canManageBillingContact ||
      view.contactSaving ||
      !view.billingContact
    )
      return;
    const key = view.key,
      version = sequence,
      contact = view.billingContact;
    const pending = contact.pendingChange;
    if (action === "begin" && !contact.canEdit) return;
    if (action !== "begin" && !pending) return;
    view.contactSaving = true;
    view.contactError = "";
    view.contactSaved = false;
    changed();
    try {
      view.contactOperationId ||= crypto.randomUUID();
      const suffix =
        action === "begin"
          ? "contact/changes"
          : `contact/changes/${encodeURIComponent(pending.operationId)}/verify`;
      const body =
        action === "begin"
          ? {
              operationId: view.contactOperationId,
              expectedRevision: contact.revision,
              ...view.contactFields,
            }
          : { code: action === "retry" ? "" : view.contactCode || "" };
      const result = await request(path(context().organizationId, suffix), {
        auth: true,
        method: "POST",
        body,
      });
      if (!current(key, version)) return;
      view.billingContact = result.contact;
      if (result.contact.status === "ready" && action !== "begin") {
        view.contactFields = { ...result.contact.details };
        view.contactSaved = true;
        view.contactCode = "";
        view.billing.billingContactRevision = result.contact.revision;
        view.contactOperationId = "";
        view.acceptedTerms = false;
      }
    } catch (error) {
      if (current(key, version)) view.contactError = billingContactError(error);
    } finally {
      if (current(key, version)) {
        view.contactSaving = false;
        changed();
      }
    }
  }

  function renderBillingContact() {
    const contact = view.billingContact,
      fields = view.contactFields || {},
      pending = contact?.pendingChange;
    const busy = view.contactSaving || view.contactLoading;
    const verifying = pending?.status === "pending_verification";
    const recovering =
      pending &&
      ["applying", "verified", "needs_attention"].includes(pending.status);
    const sendingCode = contact?.status === "sending_code";
    const field = (key, label, type, max) =>
      `<label class="texting-billing-contact__field">${label}<input data-billing-contact-field="${key}" type="${type}" value="${escape(fields[key] || "")}" maxlength="${max}" autocomplete="${key === "phone" ? "tel" : key}" ${busy || verifying || recovering || sendingCode ? "disabled" : ""}></label>`;
    return `<section class="texting-balance__card texting-billing-contact" aria-busy="${Boolean(busy)}">
      <h2>Organization billing contact</h2><p>Used for payment receipts and billing questions.</p>
      ${view.contactSaved ? '<p role="status">Billing details saved. Your texting funds are unchanged.</p>' : ""}
      ${view.contactError ? `<p class="texting-balance__notice" role="alert">${escape(view.contactError)}</p>` : ""}
      ${
        !contact
          ? `<p>${view.contactLoading ? "Loading billing details…" : "Billing details are unavailable."}</p>`
          : `
        ${field("name", "Name", "text", 150)}${field("email", "Receipt email", "email", 254)}${field("phone", "Billing phone (optional)", "tel", 24)}
        ${
          sendingCode
            ? '<p role="status">Sending the confirmation email… Refresh details shortly.</p>'
            : verifying
              ? `<p>A code was sent to ${escape(pending.emailMasked)}.</p><label class="texting-billing-contact__field">Email confirmation code<input data-billing-contact-field="code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="one-time-code" value="${escape(view.contactCode || "")}" ${busy ? "disabled" : ""}></label>
          <button class="texting-balance__button texting-balance__button--primary" data-texting-action="contact-verify" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Verify and save"}</button>
          <button class="texting-balance__link" data-texting-action="contact-new-code" ${busy ? "disabled" : ""}>Change details or request a new code</button>`
              : recovering
                ? `<p>Your email is confirmed. Finish checking the saved details.</p><button class="texting-balance__button texting-balance__button--primary" data-texting-action="contact-retry" ${busy ? "disabled" : ""}>${busy ? "Checking…" : "Finish update"}</button>`
                : `<button class="texting-balance__button texting-balance__button--primary" data-texting-action="contact-begin" ${busy || !contact.canEdit ? "disabled" : ""}>${busy ? "Sending code…" : "Continue"}</button>`
        }
      `
      }
      <button class="texting-balance__link" data-texting-action="contact-refresh" ${busy ? "disabled" : ""}>Refresh details</button>
      <details class="texting-balance__details"><summary>About payment verification</summary><p>We confirm changes at your receipt email. Your billing phone is contact information. A saved payment login or bank verification number is managed separately by its account owner.</p><p>Changing these details makes no payment and keeps your organization’s purchased texting funds.</p></details>
    </section>`;
  }

  async function checkout() {
    const pack = selectedQuote();
    if (
      identity() !== view.key ||
      view.saving ||
      !view.billing?.canManageBilling ||
      !view.billing.canPurchase ||
      !pack ||
      !view.acceptedTerms ||
      !safeUrl(view.billing.terms?.url)
    )
      return;
    const key = view.key;
    const version = sequence;
    view.saving = true;
    view.checkoutError = "";
    changed();
    try {
      const result = await request(
        path(context().organizationId, "checkouts"),
        {
          auth: true,
          method: "POST",
          body: {
            ...(pack.id === "custom"
              ? { principalCents: pack.principalCents }
              : { packId: pack.id }),
            idempotencyKey: checkoutKey(
              fundingRetryAmount({
                packId: pack.id,
                principalCents: pack.principalCents,
              }),
            ),
          },
        },
      );
      if (!current(key, version)) return;
      if (TERMINAL.has(result.purchase?.status)) {
        view.purchaseId = result.purchase.purchaseId;
        view.pollCount = 0;
        await checkPurchase();
        if (current(key, version)) {
          view.saving = false;
          changed();
        }
        return;
      }
      const url = safeUrl(result.purchase?.checkoutUrl, [
        "checkout.stripe.com",
      ]);
      if (!url) throw new Error("checkout_unavailable");
      window.location.assign(url);
    } catch (error) {
      if (!current(key, version)) return;
      view.checkoutError =
        error.status === 401 || error.status === 403
          ? "Your administrator access has changed. Refresh to check access."
          : "Checkout could not be opened. Retry to recover the same purchase; your balance has not been changed here.";
      if (error.status === 401 || error.status === 403)
        view.billing.canPurchase = false;
      view.saving = false;
      changed();
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-texting-action]");
    if (!button || button.disabled || identity() !== view.key) return;
    const action = button.dataset.textingAction;
    if (action === "refresh") {
      if (view.section === "billing-details") void loadBillingContact();
      else void refresh();
    } else if (action === "more") void history({ append: true });
    else if (action === "checkout") void checkout();
    else if (action === "add-funds") show("add-funds");
    else if (action === "balance") show("balance");
    else if (action === "history") show("history");
    else if (action === "billing-details") {
      show("billing-details");
      void loadBillingContact();
    } else if (action === "contact-refresh") void loadBillingContact();
    else if (action === "contact-begin") void saveBillingContact("begin");
    else if (action === "contact-verify") void saveBillingContact("verify");
    else if (action === "contact-retry") void saveBillingContact("retry");
    else if (action === "contact-new-code" && !view.contactSaving) {
      view.billingContact.pendingChange = null;
      view.contactCode = "";
      view.contactOperationId = "";
      changed();
    } else if (action === "pack" && !view.saving) {
      if (!view.billing?.canManageBilling || !view.billing.canPurchase) return;
      if (
        button.dataset.pack === "custom" &&
        !customFundingConfig(view.billing.customAmount)
      )
        return;
      view.selectedPack = button.dataset.pack;
      view.acceptedTerms = false;
      view.checkoutError = "";
      changed();
      if (view.selectedPack === "custom")
        requestAnimationFrame(() =>
          document.querySelector("[data-texting-custom-amount]")?.focus(),
        );
    }
  });
  document.addEventListener("input", (event) => {
    if (
      event.target.matches("[data-billing-contact-field]") &&
      identity() === view.key &&
      view.section === "billing-details" &&
      !view.contactSaving
    ) {
      const key = event.target.dataset.billingContactField;
      if (key === "code") view.contactCode = event.target.value;
      else if (["name", "email", "phone"].includes(key)) {
        view.contactFields ||= {};
        view.contactFields[key] = event.target.value;
        view.contactOperationId = "";
      }
      return;
    }
    if (
      !event.target.matches("[data-texting-custom-amount]") ||
      identity() !== view.key ||
      view.saving ||
      view.selectedPack !== "custom"
    )
      return;
    view.customAmount = event.target.value;
    view.customTouched = true;
    view.acceptedTerms = false;
    view.checkoutError = "";
    // Keep the input node and caret intact while updating its quote and feedback.
    const error = customAmountError(view.billing);
    event.target.setAttribute("aria-invalid", String(Boolean(error)));
    const feedback = document.querySelector("[data-texting-amount-error]");
    if (feedback) {
      feedback.textContent = error;
      feedback.hidden = !error;
    }
    const review = document.querySelector("[data-texting-review]");
    if (review) review.innerHTML = renderPurchaseReview(view.billing);
  });
  document.addEventListener("change", (event) => {
    if (
      event.target.matches("[data-texting-terms]") &&
      identity() === view.key &&
      !view.saving &&
      selectedQuote()
    ) {
      view.acceptedTerms = event.target.checked;
      changed();
      requestAnimationFrame(() =>
        document.querySelector("[data-texting-terms]")?.focus(),
      );
    }
  });

  /** Switch local views without creating a checkout or changing financial state. */
  function show(section = "balance") {
    if (identity() !== view.key || view.saving) return;
    if (
      !["balance", "history", "add-funds", "billing-details"].includes(section)
    )
      return;
    if (section !== "balance" && !view.billing?.canManageBilling) return;
    if (section === "add-funds" && !view.billing?.canPurchase) return;
    if (section === "billing-details" && !view.billing?.canManageBillingContact)
      return;
    view.section = section;
    const url = new URL(window.location.href);
    if (section === "billing-details") url.searchParams.set("section", section);
    else url.searchParams.delete("section");
    window.history?.replaceState?.(window.history.state, "", url.href);
    if (section === "add-funds") {
      view.selectedPack = "";
      view.customAmount = "";
      view.customTouched = false;
      view.acceptedTerms = false;
      view.checkoutError = "";
    }
    changed();
    requestAnimationFrame(() =>
      document.querySelector("[data-texting-heading]")?.focus(),
    );
  }

  function renderPurchase() {
    if (!view.purchaseId) return "";
    const purchase = view.purchase;
    const funded = purchase?.status === "funded";
    const receipt = safeUrl(purchase?.receiptUrl, [
      "pay.stripe.com",
      "invoice.stripe.com",
      "receipt.stripe.com",
    ]);
    return `<section class="texting-balance__card texting-balance__result ${funded ? "texting-balance__result--funded" : ""}" aria-live="polite" data-testid="texting-purchase-status">
      <span class="texting-balance__result-icon" aria-hidden="true">${funded ? "✓" : "↻"}</span>
      <div><h2>${escape(view.purchaseError ? "Payment status unavailable" : purchaseLabel(purchase?.status))}</h2>
      <p>${escape(
        view.purchaseError ||
          (funded
            ? `${money(purchase.principalCents)} was added to this organization's texting balance.`
            : TERMINAL.has(purchase?.status)
              ? "Your balance reflects confirmed account activity."
              : "We're confirming your payment. You can leave this page; don't pay again."),
      )}</p>
      ${receipt ? `<a href="${escape(receipt)}" target="_blank" rel="noopener noreferrer">View receipt ↗</a>` : ""}</div>
    </section>`;
  }

  function customAmountError(billing) {
    if (!view.customTouched) return "";
    const { error } = customFundingQuote(
      view.customAmount,
      billing?.customAmount,
    );
    return (
      {
        empty: "Enter an amount.",
        format: "Use dollars and up to two decimal places, such as 12.50.",
        minimum: `Enter at least ${money(billing?.customAmount?.minimumCents)}.`,
        maximum: `Enter ${money(billing?.customAmount?.maximumCents)} or less.`,
        unavailable: "Custom amounts are unavailable. Choose a listed amount.",
      }[error] || ""
    );
  }

  function renderPacks(billing) {
    if (!billing.canManageBilling || !billing.canPurchase) return "";
    const custom = customFundingConfig(billing.customAmount);
    const isCustom = view.selectedPack === "custom";
    const error = customAmountError(billing);
    return `<div class="texting-balance__purchase-grid">
      <section class="texting-balance__card">
        <span class="texting-balance__eyebrow">ONE-TIME PURCHASE</span>
        <h2>Choose your amount</h2>
        <p>Your organization receives the full amount selected.</p>
        <div class="texting-balance__packs" role="group" aria-label="Texting funds">${(
          billing.packs || []
        )
          .map(
            (item) =>
              `<button class="texting-balance__pack" data-texting-action="pack" data-pack="${escape(item.id)}" aria-pressed="${item.id === view.selectedPack}" ${view.saving ? "disabled" : ""}>${money(item.principalCents)}</button>`,
          )
          .join(
            "",
          )}${custom ? `<button class="texting-balance__pack" data-texting-action="pack" data-pack="custom" aria-pressed="${isCustom}" ${view.saving ? "disabled" : ""}>Other</button>` : ""}</div>
        ${
          custom && isCustom
            ? `<div class="texting-balance__custom">
          <label for="texting-custom-amount">Amount in dollars</label>
          <div class="texting-balance__amount-input"><span aria-hidden="true">$</span><input id="texting-custom-amount" data-texting-custom-amount type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="20" placeholder="10.00" value="${escape(view.customAmount || "")}" aria-describedby="texting-amount-hint texting-amount-error" aria-invalid="${Boolean(error)}" ${view.saving ? "disabled" : ""}></div>
          <p class="texting-balance__fine" id="texting-amount-hint">${money(custom.minimumCents)} minimum · ${money(custom.maximumCents)} maximum</p>
          <p class="texting-balance__amount-error" id="texting-amount-error" data-texting-amount-error role="alert" ${error ? "" : "hidden"}>${escape(error)}</p>
        </div>`
            : ""
        }
        <p class="texting-balance__fine">Plus a 5% service fee, including payment processing.</p>
        <details class="texting-balance__details"><summary>How texting funds work</summary>
          <p>No automatic refills, expiration, or transfers. Adding funds does not approve registration, remove holds, or restart messaging.</p>
        </details>
      </section>
      <div data-texting-review>${renderPurchaseReview(billing)}</div>
    </div>`;
  }

  function renderPurchaseReview(billing) {
    const pack = selectedQuote(billing);
    const termsUrl = safeUrl(billing.terms?.url);
    return pack
      ? `<section class="texting-balance__card texting-balance__review" aria-label="Review purchase">
          <span class="texting-balance__eyebrow">REVIEW PURCHASE</span>
          <h2>${escape(billing.organizationName || context().organizationId)}</h2>
          ${pack.notice ? `<p class="texting-balance__notice">${escape(pack.notice)}</p>` : ""}
          <dl><dt>Texting funds</dt><dd>${money(pack.principalCents)}</dd>
            <dt>Service fee (5%)</dt><dd>${money(pack.serviceFeeCents)}</dd>
            <dt class="texting-balance__total">Total before applicable tax</dt><dd class="texting-balance__total">${money(pack.totalBeforeTaxCents)}</dd></dl>
          <p class="texting-balance__fine">${escape(billing.terms?.taxNotice || "Any applicable tax and your final total will be shown in secure checkout before payment.")}</p>
          <p class="texting-balance__fine">${escape(billing.terms?.refundPolicy || "No routine refunds. Contact support for payment errors, disputes, or refunds required by law.")}</p>
          ${termsUrl ? `<a href="${escape(termsUrl)}" target="_blank" rel="noopener noreferrer">Read payment terms ↗</a>` : "<p>Payment terms must be available before checkout can open.</p>"}
          <label class="texting-balance__terms"><input type="checkbox" data-texting-terms ${view.acceptedTerms ? "checked" : ""} ${view.saving ? "disabled" : ""}><span>I agree to the payment terms and authorize this organization's purchase.</span></label>
          <button class="texting-balance__button texting-balance__button--primary texting-balance__button--full" data-texting-action="checkout" ${!view.acceptedTerms || !termsUrl || view.saving ? "disabled" : ""}>${view.saving ? "Opening checkout…" : "Continue to secure checkout"}</button>
          <p class="texting-balance__fine texting-balance__secure">Payment is completed through secure checkout.</p>
          ${view.checkoutError ? `<p class="texting-balance__notice" role="alert">${escape(view.checkoutError)}</p>` : ""}
        </section>`
      : `<section class="texting-balance__card texting-balance__placeholder"><span aria-hidden="true">＋</span><h2>Ready when you are</h2><p>${view.selectedPack === "custom" ? "Enter your amount to review the total." : "Select an amount to review the total."}</p></section>`;
  }

  function renderHistory(billing, preview = false) {
    if (!billing.canManageBilling) return "";
    const items = view.transactions || [];
    return `<section class="texting-balance__card">
      <div class="texting-balance__section-heading"><h2>${preview ? "Recent purchases" : "Purchase history"}</h2>
      ${preview ? '<button class="texting-balance__link" data-texting-action="history">View all</button>' : ""}</div>
      ${view.historyError ? `<p role="alert">${escape(view.historyError)}</p>` : ""}
      <div class="texting-balance__history">${
        (preview ? items.slice(0, 3) : items)
          .map((item) => {
            const receipt = safeUrl(item.receiptUrl, [
              "pay.stripe.com",
              "invoice.stripe.com",
              "receipt.stripe.com",
            ]);
            const date = new Date(item.createdAt || item.createdAtMs);
            return `<article class="texting-balance__transaction"><div class="texting-balance__transaction-icon" aria-hidden="true">↙</div><div class="texting-balance__transaction-copy"><strong>${money(item.principalCents)} texting funds</strong>
            <span>${escape(purchaseLabel(item.status))}${Number.isNaN(date.valueOf()) ? "" : ` · ${escape(date.toLocaleDateString())}`}</span>
            <span>Fee ${money(item.serviceFeeCents)} · Tax ${Number.isSafeInteger(item.taxCents) ? money(item.taxCents) : "Pending"} · Total ${Number.isSafeInteger(item.totalCents) ? money(item.totalCents) : "Pending"}</span></div>
            ${receipt ? `<a href="${escape(receipt)}" target="_blank" rel="noopener noreferrer">View receipt ↗</a>` : ""}</article>`;
          })
          .join("") ||
        `<div class="texting-balance__empty"><p>${view.historyLoading ? "Loading purchases…" : "No purchases yet."}</p>${!view.historyLoading ? '<span class="texting-balance__fine">Confirmed purchases and receipts appear here.</span>' : ""}</div>`
      }</div>
      ${!preview && view.nextCursor ? `<button class="texting-balance__button" data-texting-action="more" ${view.historyLoading ? "disabled" : ""}>Load more purchases</button>` : ""}
    </section>`;
  }

  function renderBalance(billing) {
    const capacityVerified =
      billing.rateStatus === "verified" &&
      Number.isSafeInteger(billing.estimatedSmsMessages) &&
      Number.isSafeInteger(billing.estimatedMmsMessages);
    const ratesVerified =
      billing.rateStatus === "verified" &&
      Number.isSafeInteger(billing.smsUpToTwoSegmentsMicros) &&
      Number.isSafeInteger(billing.smsAdditionalSegmentMicros) &&
      Number.isSafeInteger(billing.mmsMicros);
    return `<div class="texting-balance__overview">
      <section class="texting-balance__card texting-balance__hero">
        <span class="texting-balance__eyebrow">AVAILABLE TO SEND</span>
        <strong class="texting-balance__amount" data-testid="texting-available">${money(billing.availableMicros, 1000000)}</strong>
        ${
          capacityVerified
            ? `<div class="texting-balance__capacity"><div><strong>${billing.estimatedSmsMessages.toLocaleString()}</strong><span>SMS · up to 2 segments</span></div><span class="texting-balance__capacity-or">or</span><div><strong>${billing.estimatedMmsMessages.toLocaleString()}</strong><span>MMS messages</span></div></div><p class="texting-balance__fine">Estimated capacity before other messaging charges.</p>`
            : '<p class="texting-balance__fine">Message capacity appears once your rates are verified.</p>'
        }
        ${billing.canManageBilling && billing.canPurchase ? '<button class="texting-balance__button texting-balance__button--primary" data-texting-action="add-funds">Add texting funds</button>' : ""}
        ${billing.canManageBillingContact ? '<button class="texting-balance__button" data-texting-action="billing-details">Billing details</button>' : ""}
        ${!billing.canManageBilling ? '<p class="texting-balance__fine">An organization administrator can add funds.</p>' : !billing.canPurchase ? '<p class="texting-balance__fine">Purchases are unavailable until your organization is eligible.</p>' : ""}
      </section>
      <section class="texting-balance__card texting-balance__usage"><h2>Usage</h2>
        <div><span>Pending charges</span><strong>${money(billing.reservedMicros, 1000000)}</strong></div>
        <div><span>Completed usage</span><strong>${money(billing.settledMicros, 1000000)}</strong></div>
        <p class="texting-balance__fine">Pending charges are held for messages awaiting settlement.</p>
        ${ratesVerified ? `<details class="texting-balance__details"><summary>View your messaging rates</summary><p>${rateMoney(billing.smsUpToTwoSegmentsMicros)} per SMS including up to two segments.<br>${rateMoney(billing.smsAdditionalSegmentMicros)} per additional SMS segment.<br>${rateMoney(billing.mmsMicros)} per complete MMS.</p>${billing.optInRates?.rateStatus === "verified" ? `<p><strong>Opt-in texting</strong><br>${rateMoney(billing.optInRates.smsSegmentMicros)} per SMS segment.<br>${rateMoney(billing.optInRates.mmsMicros)} per complete MMS.</p>` : ""}<p>Longer SMS messages use additional funds. Your payment terms describe other applicable messaging charges.</p></details>` : ""}
      </section>
    </div>${renderHistory(billing, true)}`;
  }

  function render() {
    const billing =
      identity() === view.key && view.billing?.canManageBilling === true
        ? view.billing
        : null;
    const section =
      billing?.canManageBilling &&
      (view.section !== "billing-details" || billing.canManageBillingContact) &&
      (view.section !== "add-funds" || billing.canPurchase)
        ? view.section || "balance"
        : "balance";
    const title =
      section === "add-funds"
        ? "Add texting funds"
        : section === "history"
          ? "Purchase history"
          : section === "billing-details"
            ? "Billing details"
            : "Texting balance";
    return `<div class="texting-balance">
      ${section !== "balance" ? '<button class="texting-balance__link texting-balance__back" data-texting-action="balance">← Back to balance</button>' : ""}
      <div class="texting-balance__header"><div><span class="texting-balance__eyebrow">${escape(billing?.organizationName || "TEXTING")}</span><h1 tabindex="-1" data-texting-heading>${title}</h1></div>
        <button class="texting-balance__button" data-texting-action="refresh" ${view.loading || view.saving || view.contactSaving || view.contactLoading ? "disabled" : ""}>${section === "billing-details" ? "Refresh details" : "Refresh balance"}</button></div>
      ${view.error && identity() === view.key ? `<p class="texting-balance__notice" role="alert">${escape(view.error)}</p>` : ""}
      ${
        !billing
          ? `<section class="texting-balance__card" aria-live="polite"><p>${view.loading ? "Loading texting balance…" : "No balance is available."}</p></section>`
          : `${renderTextingRenewals(billing.renewalDeadlines, true, "texting-balance__notice")}${billing.environment === "test" ? '<p class="texting-balance__notice">Test mode — no real payment is collected.</p>' : ""}
          ${billing.sendingBlocked ? `<div class="texting-balance__notice"><strong>Sending is paused.</strong> ${billing.billingHold ? "Contact support to resolve the billing hold. Adding funds won't remove it." : "Funding, registration, and messaging requirements must be met before sending."}</div>` : ""}
          ${view.canceledReturn && !view.purchase ? '<p class="texting-balance__notice">Checkout was closed. Funds are added only after payment is confirmed.</p>' : ""}
          ${renderPurchase()}
          ${section === "billing-details" ? renderBillingContact() : section === "add-funds" ? renderPacks(billing) : section === "history" ? renderHistory(billing) : renderBalance(billing)}
          ${/^[^\s@<>]+@[^\s@<>]+$/.test(billing.terms?.supportEmail || "") ? `<footer class="texting-balance__support">Payment help · <a href="mailto:${escape(billing.terms.supportEmail)}">${escape(billing.terms.supportEmail)}</a></footer>` : ""}`
      }
    </div>`;
  }

  const getMeta = () => ({
    authorizationStatus:
      identity() !== view.key
        ? "pending"
        : view.accessDenied
          ? "denied"
          : view.authorizationReady
            ? "ready"
            : "pending",
    organizationName:
      identity() === view.key ? view.billing?.organizationName || "" : "",
    capabilities: {
      readContactBook: identity() === view.key && view.readContactBook === true,
      manageBilling:
        identity() === view.key && view.billing?.canManageBilling === true,
    },
  });
  return { load, render, reset, refresh, show, getMeta };
}
