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
        view.section = "balance";
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
      section: "balance",
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
      if (!result.billing || result.billing.currency !== "usd")
        throw new Error("billing_unavailable");
      const oldPack = view.billing?.packs?.find(
        (item) => item.id === view.selectedPack,
      );
      const newPack = result.billing.packs?.find(
        (item) => item.id === view.selectedPack,
      );
      if (
        JSON.stringify(oldPack) !== JSON.stringify(newPack) ||
        view.billing?.terms?.version !== result.billing.terms?.version
      ) {
        view.acceptedTerms = false;
      }
      view.billing = result.billing;
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
    if (action === "refresh") void refresh();
    else if (action === "more") void history({ append: true });
    else if (action === "checkout") void checkout();
    else if (action === "add-funds") show("add-funds");
    else if (action === "balance") show("balance");
    else if (action === "history") show("history");
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
      requestAnimationFrame(() =>
        document.querySelector("[data-texting-terms]")?.focus(),
      );
    }
  });

  /** Switch local views without creating a checkout or changing financial state. */
  function show(section = "balance") {
    if (identity() !== view.key || view.saving) return;
    if (!["balance", "history", "add-funds"].includes(section)) return;
    if (section !== "balance" && !view.billing?.canManageBilling) return;
    if (section === "add-funds" && !view.billing?.canPurchase) return;
    view.section = section;
    if (section === "add-funds") {
      view.selectedPack = "";
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

  function renderPacks(billing) {
    if (!billing.canManageBilling || !billing.canPurchase) return "";
    const pack = billing.packs?.find((item) => item.id === view.selectedPack);
    const termsUrl = safeUrl(billing.terms?.url);
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
          .join("")}</div>
        <p class="texting-balance__fine">Plus a 5% service fee, including payment processing.</p>
        <details class="texting-balance__details"><summary>How texting funds work</summary>
          <p>No automatic refills, expiration, or transfers. Adding funds does not approve registration, remove holds, or restart messaging.</p>
        </details>
      </section>
      ${
        pack
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
          <p class="texting-balance__fine texting-balance__secure">Payment is completed securely with Stripe.</p>
          ${view.checkoutError ? `<p class="texting-balance__notice" role="alert">${escape(view.checkoutError)}</p>` : ""}
        </section>`
          : `<section class="texting-balance__card texting-balance__placeholder"><span aria-hidden="true">＋</span><h2>Ready when you are</h2><p>Select an amount to review the total.</p></section>`
      }
    </div>`;
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
        ${!billing.canManageBilling ? '<p class="texting-balance__fine">An organization administrator can add funds.</p>' : !billing.canPurchase ? '<p class="texting-balance__fine">Purchases are unavailable until your organization is eligible.</p>' : ""}
      </section>
      <section class="texting-balance__card texting-balance__usage"><h2>Usage</h2>
        <div><span>Pending charges</span><strong>${money(billing.reservedMicros, 1000000)}</strong></div>
        <div><span>Completed usage</span><strong>${money(billing.settledMicros, 1000000)}</strong></div>
        <p class="texting-balance__fine">Pending charges are held for messages awaiting settlement.</p>
        ${ratesVerified ? `<details class="texting-balance__details"><summary>View your messaging rates</summary><p>${money(billing.smsUpToTwoSegmentsMicros, 1000000)} per SMS including up to two segments.<br>${money(billing.smsAdditionalSegmentMicros, 1000000)} per additional SMS segment.<br>${money(billing.mmsMicros, 1000000)} per complete MMS.</p><p>Longer SMS messages use additional funds. Your payment terms describe other applicable messaging charges.</p></details>` : ""}
      </section>
    </div>${renderHistory(billing, true)}`;
  }

  function render() {
    const billing = identity() === view.key ? view.billing : null;
    const section =
      billing?.canManageBilling &&
      (view.section !== "add-funds" || billing.canPurchase)
        ? view.section || "balance"
        : "balance";
    const title =
      section === "add-funds"
        ? "Add texting funds"
        : section === "history"
          ? "Purchase history"
          : "Texting balance";
    return `<div class="texting-balance">
      ${section !== "balance" ? '<button class="texting-balance__link texting-balance__back" data-texting-action="balance">← Back to balance</button>' : ""}
      <div class="texting-balance__header"><div><span class="texting-balance__eyebrow">${escape(billing?.organizationName || "TEXTING")}</span><h1 tabindex="-1" data-texting-heading>${title}</h1></div>
        <button class="texting-balance__button" data-texting-action="refresh" ${view.loading || view.saving ? "disabled" : ""}>Refresh balance</button></div>
      ${view.error && identity() === view.key ? `<p class="texting-balance__notice" role="alert">${escape(view.error)}</p>` : ""}
      ${
        !billing
          ? `<section class="texting-balance__card" aria-live="polite"><p>${view.loading ? "Loading texting balance…" : "No balance is available."}</p></section>`
          : `${billing.environment === "test" ? '<p class="texting-balance__notice">Test mode — no real payment is collected.</p>' : ""}
          ${billing.sendingBlocked ? `<div class="texting-balance__notice"><strong>Sending is paused.</strong> ${billing.billingHold ? "Contact support to resolve the billing hold. Adding funds won't remove it." : "Funding, registration, and messaging requirements must be met before sending."}</div>` : ""}
          ${view.canceledReturn && !view.purchase ? '<p class="texting-balance__notice">Checkout was closed. Funds are added only after payment is confirmed.</p>' : ""}
          ${renderPurchase()}
          ${section === "add-funds" ? renderPacks(billing) : section === "history" ? renderHistory(billing) : renderBalance(billing)}
          ${/^[^\s@<>]+@[^\s@<>]+$/.test(billing.terms?.supportEmail || "") ? `<footer class="texting-balance__support">Payment help · <a href="mailto:${escape(billing.terms.supportEmail)}">${escape(billing.terms.supportEmail)}</a></footer>` : ""}`
      }
    </div>`;
  }

  const getMeta = () => ({
    organizationName:
      identity() === view.key ? view.billing?.organizationName || "" : "",
  });
  return { load, render, reset, refresh, show, getMeta };
}
