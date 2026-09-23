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
        maximumFractionDigits: divisor === 1000000 ? 3 : 2,
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
  const path = (organizationId, suffix) =>
    `/api/text-banking/prompt/scopes/${encodeURIComponent(`coalition:${organizationId}`)}/billing/${suffix}`;

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
      view.billing = summary.billing;
      if (!view.billing?.canManageBilling) {
        view.purchase = null;
        view.purchaseId = "";
        view.transactions = [];
        return;
      }
      if (TERMINAL.has(view.purchase?.status)) {
        retryKeys.delete(
          `polis.textingCheckout.${view.key}.${view.purchase.packId}`,
        );
        try {
          sessionStorage.removeItem(
            `polis.textingCheckout.${view.key}.${view.purchase.packId}`,
          );
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
    };
    changed();
    try {
      const result = await request(path(organizationId, "summary"), {
        auth: true,
      });
      if (!current(key, version)) return;
      if (!result.billing || result.billing.currency !== "usd")
        throw new Error("billing_unavailable");
      view.billing = result.billing;
      if (view.billing.canManageBilling) {
        await history();
        await checkPurchase();
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

  /** Retain a retry key across uncertain HTTP results and page refreshes. */
  function checkoutKey(packId) {
    const storageKey = `polis.textingCheckout.${view.key}.${packId}`;
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

  async function checkout() {
    const pack = view.billing?.packs?.find(
      (item) => item.id === view.selectedPack,
    );
    if (
      view.saving ||
      !view.billing?.canManageBilling ||
      !view.billing.canPurchase ||
      !pack ||
      !view.acceptedTerms
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
          body: { packId: pack.id, idempotencyKey: checkoutKey(pack.id) },
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
    if (action === "refresh") void load();
    else if (action === "more") void history({ append: true });
    else if (action === "checkout") void checkout();
    else if (action === "pack" && !view.saving) {
      view.selectedPack = button.dataset.pack;
      view.acceptedTerms = false;
      view.checkoutError = "";
      changed();
    }
  });
  document.addEventListener("change", (event) => {
    if (
      event.target.matches("[data-texting-terms]") &&
      identity() === view.key
    ) {
      view.acceptedTerms = event.target.checked;
      changed();
    }
  });

  function renderPurchase() {
    if (!view.purchaseId) return "";
    const purchase = view.purchase;
    const receipt = safeUrl(purchase?.receiptUrl, [
      "pay.stripe.com",
      "invoice.stripe.com",
      "receipt.stripe.com",
    ]);
    return `<section class="shared-coalition-panel" aria-live="polite" data-testid="texting-purchase-status">
      <h2>${escape(view.purchaseError ? "Payment status unavailable" : purchaseLabel(purchase?.status))}</h2>
      <p>${escape(
        view.purchaseError ||
          (purchase?.status === "funded"
            ? `${money(purchase.principalCents)} was added to this organization's texting balance.`
            : TERMINAL.has(purchase?.status)
              ? "The balance above reflects confirmed account activity."
              : "Waiting for payment confirmation. Leaving this page will not interrupt processing. No funds are added based on this return page."),
      )}</p>
      ${receipt ? `<a href="${escape(receipt)}" target="_blank" rel="noopener noreferrer">View receipt</a>` : ""}
    </section>`;
  }

  function renderPacks(billing) {
    if (!billing.canManageBilling)
      return "<p>Only organization administrators can add texting funds or view purchases.</p>";
    if (!billing.canPurchase) {
      const acceptanceNotices = {
        acceptance_purchase_completed:
          "Your acceptance purchase is complete. Additional purchases will be available after the controlled acceptance check.",
        acceptance_purchase_not_authorized:
          "This acceptance purchase is reserved for the designated administrator.",
        acceptance_purchase_expired:
          "The acceptance purchase window has expired. Contact beta support before trying again.",
        purchase_window_expiring:
          "This purchase window is closing. Contact beta support before trying again.",
      };
      const reason = billing.blockedReasons?.find(
        (item) => acceptanceNotices[item],
      );
      return `<p>${reason ? acceptanceNotices[reason] : "Purchases are unavailable until registration approval and billing setup are complete and any billing hold is resolved."}</p>`;
    }
    const pack = billing.packs?.find((item) => item.id === view.selectedPack);
    const termsUrl = safeUrl(billing.terms?.url);
    return `<section class="shared-coalition-panel">
      <h2>Add texting funds</h2>
      <p>The full amount selected becomes texting funds. The 5% Polis service fee includes payment processing.</p>
      <div class="texting-balance__packs">${(billing.packs || [])
        .map(
          (item) =>
            `<button class="shared-feed-chip" data-texting-action="pack" data-pack="${escape(item.id)}" aria-pressed="${item.id === view.selectedPack}" ${view.saving ? "disabled" : ""}>${money(item.principalCents)}</button>`,
        )
        .join("")}</div>
      ${
        pack
          ? `<div class="texting-balance__review">
        <h3>Review purchase for ${escape(billing.organizationName || context().organizationId)}</h3>
        <dl><dt>Texting funds</dt><dd>${money(pack.principalCents)}</dd>
          <dt>Polis service fee (5%)</dt><dd>${money(pack.serviceFeeCents)}</dd>
          <dt>Total before applicable tax</dt><dd>${money(pack.totalBeforeTaxCents)}</dd></dl>
        ${pack.notice ? `<p>${escape(pack.notice)}</p>` : ""}
        <p>${escape(billing.terms?.taxNotice || "Any applicable tax and your final total will be shown in secure checkout before payment.")}</p>
        <p>${escape(billing.terms?.refundPolicy || "No routine refunds. Contact support for payment errors, disputes, or refunds required by law.")}</p>
        <p>One-time purchase. No automatic refills, expiration, or transfers. Adding funds does not approve registration or restart messaging.</p>
        ${termsUrl ? `<a href="${escape(termsUrl)}" target="_blank" rel="noopener noreferrer">Read payment terms</a>` : "<p>Payment terms must be available before checkout can open.</p>"}
        <label class="texting-balance__terms"><input type="checkbox" data-texting-terms ${view.acceptedTerms ? "checked" : ""} ${view.saving ? "disabled" : ""}> I agree to the payment terms and authorize this organization's purchase.</label>
        <button class="shared-feed-chip" data-texting-action="checkout" ${!view.acceptedTerms || !termsUrl || view.saving ? "disabled" : ""}>${view.saving ? "Opening checkout…" : "Continue to secure checkout"}</button>
        ${view.checkoutError ? `<p role="alert">${escape(view.checkoutError)}</p>` : ""}
      </div>`
          : ""
      }
    </section>`;
  }

  function renderHistory(billing) {
    if (!billing.canManageBilling) return "";
    return `<section class="shared-coalition-panel"><h2>Purchase history</h2>
      ${view.historyError ? `<p role="alert">${escape(view.historyError)}</p>` : ""}
      <div class="texting-balance__history">${
        (view.transactions || [])
          .map((item) => {
            const receipt = safeUrl(item.receiptUrl, [
              "pay.stripe.com",
              "invoice.stripe.com",
              "receipt.stripe.com",
            ]);
            const date = new Date(item.createdAt || item.createdAtMs);
            return `<article class="texting-balance__transaction"><strong>${money(item.principalCents)} texting funds</strong>
          <span>${escape(purchaseLabel(item.status))} · ${Number.isNaN(date.valueOf()) ? "" : escape(date.toLocaleDateString())}</span>
          <span>Fee ${money(item.serviceFeeCents)} · Tax ${Number.isSafeInteger(item.taxCents) ? money(item.taxCents) : "Pending"} · Total ${Number.isSafeInteger(item.totalCents) ? money(item.totalCents) : "Pending"}</span>
          ${receipt ? `<a href="${escape(receipt)}" target="_blank" rel="noopener noreferrer">View receipt</a>` : ""}</article>`;
          })
          .join("") ||
        `<p>${view.historyLoading ? "Loading purchases…" : "No purchases yet."}</p>`
      }</div>
      ${view.nextCursor ? `<button class="shared-feed-chip" data-texting-action="more" ${view.historyLoading ? "disabled" : ""}>Load more purchases</button>` : ""}
    </section>`;
  }

  function render() {
    const billing = identity() === view.key ? view.billing : null;
    return `<div class="shared-page__content texting-balance">
      <div class="shared-page__header"><div><h1>Texting balance</h1>
        <p>${escape(billing?.organizationName || context()?.organizationId || "")}</p></div>
        <button class="shared-feed-chip" data-texting-action="refresh" ${view.loading ? "disabled" : ""}>Refresh balance</button></div>
      ${view.error && identity() === view.key ? `<p role="alert">${escape(view.error)}</p>` : ""}
      ${
        !billing
          ? `<p>${view.loading ? "Loading texting balance…" : "No balance is available."}</p>`
          : `
        ${billing.environment === "test" ? '<p class="shared-page__banner">Test mode — no real payment is collected.</p>' : ""}
        <div class="texting-balance__metrics">
          <article class="shared-coalition-panel"><span>Available funds</span><strong data-testid="texting-available">${money(billing.availableMicros, 1000000)}</strong></article>
          <article class="shared-coalition-panel"><span>Pending message charges</span><strong>${money(billing.reservedMicros, 1000000)}</strong></article>
          <article class="shared-coalition-panel"><span>Completed usage</span><strong>${money(billing.settledMicros, 1000000)}</strong></article>
        </div>
        ${
          billing.rateStatus === "verified" &&
          Number.isSafeInteger(billing.estimatedSmsMessages) &&
          Number.isSafeInteger(billing.estimatedMmsMessages)
            ? `<p>Estimated capacity: ${billing.estimatedSmsMessages.toLocaleString()} SMS messages of up to two segments or ${billing.estimatedMmsMessages.toLocaleString()} MMS messages, before other applicable messaging charges. Longer SMS messages use additional funds.</p>`
            : "<p>Message capacity will be available after messaging rates are verified.</p>"
        }
        ${
          billing.rateStatus === "verified" &&
          Number.isSafeInteger(billing.smsUpToTwoSegmentsMicros) &&
          Number.isSafeInteger(billing.smsAdditionalSegmentMicros) &&
          Number.isSafeInteger(billing.mmsMicros)
            ? `<p>Current rates: ${money(billing.smsUpToTwoSegmentsMicros, 1000000)} per SMS including up to two segments, ${money(billing.smsAdditionalSegmentMicros, 1000000)} per additional SMS segment, and ${money(billing.mmsMicros, 1000000)} per complete MMS.</p>`
            : ""
        }
        ${billing.sendingBlocked ? `<p class="shared-page__banner">Sending is paused. ${billing.billingHold ? "A billing hold must be resolved by support; adding funds does not remove it." : "Funding, registration, and messaging requirements must all be met before sending."}</p>` : ""}
        ${view.canceledReturn && !view.purchase ? "<p>Checkout was closed. Your balance changes only after a confirmed payment.</p>" : ""}
        ${renderPurchase()}${renderPacks(billing)}${renderHistory(billing)}
        ${/^[^\s@<>]+@[^\s@<>]+$/.test(billing.terms?.supportEmail || "") ? `<p>Payment help: <a href="mailto:${escape(billing.terms.supportEmail)}">${escape(billing.terms.supportEmail)}</a></p>` : ""}
      `
      }
    </div>`;
  }

  return { load, render, reset };
}
