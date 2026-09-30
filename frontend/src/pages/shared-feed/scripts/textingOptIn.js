import {
  escapeText as e,
  customerText,
  money,
  field,
  textarea,
  checkedUrl,
} from "./textingWorkspaceUi";

const editable = new Set([
  "draft",
  "ready_to_submit",
  "changes_required",
  "denied",
]);
const statuses = {
  draft: "Draft",
  ready_to_submit: "Ready to submit",
  submitted: "Submitted",
  reviewing: "In review",
  changes_required: "Changes needed",
  denied: "Not approved",
  approved: "Approved",
  suspended: "Paused",
  manual_review: "Needs review",
};
const steps = ["Organization", "Messaging", "Review"];
const organizationFields = [
  ["legalEntityName", "Legal organization name"],
  ["dba", "Public name (optional)"],
  ["taxEin", "EIN"],
  ["entityStreetAddress", "Street address"],
  ["entityCity", "City"],
  ["entityState", "State"],
  ["entityZip", "ZIP code"],
  ["firstName", "Contact first name"],
  ["lastName", "Contact last name"],
  ["email", "Contact email", "email"],
  ["phone", "Contact phone", "tel"],
  ["websiteAddress", "Website", "url"],
];
const messagingFields = [
  ["privacyPolicyUrl", "Privacy policy", "url"],
  ["termsUrl", "Terms", "url"],
  ["filingUrl", "Public political filing", "url"],
  ["filingInstructions", "Filing details (optional)"],
  ["areaCode1", "Preferred area code"],
  ["areaCode2", "Second choice (optional)"],
];
const optional = new Set([
  "dba",
  "filingInstructions",
  "sampleMessage3",
  "areaCode2",
]);
const applicationFields = [...organizationFields, ...messagingFields]
  .map(([name]) => name)
  .concat([
    "country",
    "useCaseDescription",
    "consentFlow",
    "sampleMessage1",
    "sampleMessage2",
    "sampleMessage3",
    "authorityConfirmed",
  ]);
const input = (name, title, value, type = "text", required = true) =>
  field(name, title, value, {
    type,
    required,
    max: name.endsWith("Url") || name === "websiteAddress" ? 2000 : 200,
  });
const action = (name, title, disabled = false, secondary = false) =>
  `<button type="button" class="pt-btn${secondary ? " pt-btn--secondary" : ""}" data-opt-in-action="${e(name)}"${disabled ? " disabled" : ""}>${e(title)}</button>`;

/** Validate the current step without replacing the server's authoritative review. */
export function validateOptInStep(
  application,
  step,
  { hasEin = false, hasToken = false, token = "", expiresOn = "" } = {},
) {
  const a = application || {};
  const fields =
    step === 0 ? organizationFields : step === 1 ? messagingFields : [];
  for (const [name, title, type] of fields) {
    const value = String(a[name] || "").trim();
    if (!value && !optional.has(name) && !(name === "taxEin" && hasEin))
      return `Enter ${title.toLowerCase()}.`;
    if (value && type === "url") {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password)
          return `Use a public HTTPS link for ${title.toLowerCase()}.`;
      } catch {
        return `Enter a valid ${title.toLowerCase()} link.`;
      }
    }
  }
  if (step === 1) {
    if (String(a.useCaseDescription || "").trim().length < 40)
      return "Describe your messaging purpose in at least 40 characters.";
    if (String(a.consentFlow || "").trim().length < 40)
      return "Describe how people opt in in at least 40 characters.";
    if (
      ![a.sampleMessage1, a.sampleMessage2].every((value) =>
        /\bSTOP\b/i.test(value || ""),
      )
    )
      return "Include STOP instructions in both sample messages.";
    if (
      !/^\d{3}$/.test(a.areaCode1 || "") ||
      (a.areaCode2 && !/^\d{3}$/.test(a.areaCode2))
    )
      return "Enter a three-digit area code.";
  }
  if (step === 0) {
    if (a.taxEin && !/^\d{9}$/.test(a.taxEin.replace(/-/g, "")))
      return "Enter the nine-digit EIN.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email || ""))
      return "Enter a valid contact email.";
    if (!/^[A-Za-z]{2}$/.test(a.entityState || ""))
      return "Use the two-letter state abbreviation.";
  }
  if (step === 2) {
    if (!hasToken && !token.trim()) return "Enter your verification token.";
    if (
      token &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
        expiresOn <= new Date().toISOString().slice(0, 10) ||
        !Number.isFinite(Date.parse(`${expiresOn}T00:00:00Z`)) ||
        new Date(`${expiresOn}T00:00:00Z`).toISOString().slice(0, 10) !==
          expiresOn)
    )
      return "Enter a future verification expiration date.";
    if (a.authorityConfirmed !== true)
      return "Confirm your authority to submit this application.";
  }
  return "";
}

/** Secondary registration stays in the settings page and never starts messaging on approval. */
export function createTextingOptIn({ request, context, changed }) {
  let state = {},
    generation = 0;
  const identity = () =>
    `${context()?.userId || ""}:${context()?.organizationId || ""}`;
  const active = (key, version) =>
    state.key === key &&
    identity() === key &&
    generation === version &&
    context()?.section === "settings";
  const base = () =>
    `/api/text-banking/workspaces/${encodeURIComponent(`coalition:${context().organizationId}`)}`;
  const mayEdit = () =>
    state.registration == null || editable.has(state.registration.status);
  const locked = () => state.busy || state.uncertain || !mayEdit();
  function reset() {
    generation++;
    state = {};
  }
  async function api(suffix, body, method = "POST") {
    const key = state.key,
      version = generation;
    const guard = () => {
      if (!active(key, version)) throw new Error("Texting settings changed.");
    };
    guard();
    const result = await request(`${base()}${suffix}`, {
      auth: true,
      beforeRequest: guard,
      ...(body === undefined ? {} : { method, body }),
    });
    guard();
    if (result?.ok !== true)
      throw new Error(
        "Settings could not be verified. Refresh to check the saved status.",
      );
    return result;
  }
  function accept(result) {
    const registration = result.registration;
    if (
      registration &&
      (!Number.isSafeInteger(registration.revision) ||
        !statuses[registration.status])
    )
      throw new Error("Application status could not be verified.");
    state.registration = registration;
    const values = {
      country: "US",
      ...state.prefill,
      ...result.prefill,
      ...registration?.application,
      taxEin: "",
    };
    state.application = Object.fromEntries(
      applicationFields
        .filter((name) => values[name] !== undefined)
        .map((name) => [name, values[name]]),
    );
    state.capabilities = result.capabilities || {};
    state.quote = result.quote || null;
    state.chargesAccepted = false;
    state.authorizationId = result.authorizationId || null;
    if (result.verificationUrl)
      state.verificationUrl = checkedUrl(result.verificationUrl);
    state.token = "";
    state.expiresOn = registration?.verificationExpiresOn || "";
    state.dirty = false;
  }
  async function read() {
    const [settings, registration, review] = await Promise.all([
      api("/settings"),
      api("/opt-in-registration"),
      api("/review"),
    ]);
    if (
      !Number.isSafeInteger(settings.settings?.revision) ||
      !["single", "dual"].includes(settings.settings.routingMode)
    )
      throw new Error("Texting mode could not be verified.");
    state.settings = settings.settings;
    state.reviewItems = Array.isArray(review.items) ? review.items : [];
    state.reviewCursor = review.nextCursor || null;
    accept(registration);
    state.uncertain = false;
  }
  async function load({
    enabled = false,
    canManage = false,
    prefill = {},
  } = {}) {
    reset();
    state = {
      key: identity(),
      visible: canManage,
      enabled,
      prefill,
      capabilities: {},
      step: 0,
      loading: canManage,
    };
    if (!canManage) return;
    const key = state.key,
      version = generation;
    try {
      await read();
    } catch (error) {
      if (active(key, version)) state.error = customerText(error.message);
    } finally {
      if (active(key, version)) {
        state.loading = false;
        changed();
      }
    }
  }
  function fields() {
    const a = state.application || {};
    if (state.step === 0)
      return `<div class="pt-fields">${organizationFields.map(([name, title, type]) => input(name, name === "taxEin" && state.registration?.einLast4 ? `EIN (saved ending ${state.registration.einLast4})` : title, a[name] || "", type, !optional.has(name) && !(name === "taxEin" && state.registration?.einLast4))).join("")}</div>`;
    if (state.step === 1)
      return `<div class="pt-fields">${messagingFields.map(([name, title, type]) => input(name, title, a[name] || "", type, !optional.has(name))).join("")}${textarea("useCaseDescription", "Messaging purpose", a.useCaseDescription || "", true, 4000)}${textarea("consentFlow", "How people opt in", a.consentFlow || "", true, 4000)}${textarea("sampleMessage1", "First sample message", a.sampleMessage1 || "", true)}${textarea("sampleMessage2", "Second sample message", a.sampleMessage2 || "", true)}${textarea("sampleMessage3", "Third sample (optional)", a.sampleMessage3 || "")}</div>`;
    return `<p class="pt-muted">Review your application and registration charge before submitting.</p>${state.verificationUrl ? `<p><a href="${e(state.verificationUrl)}" target="_blank" rel="noopener noreferrer">Open verification service</a></p>` : ""}<div class="pt-fields">${input("verificationToken", state.registration?.hasVerificationToken ? "Replace saved verification token (optional)" : "Verification token", state.token || "", "password", !state.registration?.hasVerificationToken)}${input("verificationExpiresOn", "Token expiration", state.expiresOn || "", "date", Boolean(state.token))}</div>${state.registration?.hasVerificationToken ? `<p class="pt-muted">Verification is stored securely.</p>` : ""}<label class="pt-workspace-check"><input type="checkbox" name="authorityConfirmed"${a.authorityConfirmed ? " checked" : ""}>I am authorized to share this organization’s information for registration review.</label><details class="pt-workspace-details"><summary>Review application</summary><dl>${[
      ...organizationFields,
      ...messagingFields,
    ]
      .filter(([name]) => name !== "taxEin")
      .map(
        ([name, title]) => `<dt>${e(title)}</dt><dd>${e(a[name] || "—")}</dd>`,
      )
      .join(
        "",
      )}</dl></details>${state.quote ? `<p class="pt-notice">Registration charge: <strong>${money(state.quote.amountMicros)}</strong>${Number.isSafeInteger(state.quote.numberMonthlyMicros) ? `<br>Sending number: ${money(state.quote.numberMonthlyMicros)} per month` : ""}${state.quote.requiresPayment ? " · Payment required before submission" : ""}</p><label class="pt-workspace-check"><input type="checkbox" name="chargesAccepted"${state.chargesAccepted ? " checked" : ""}>I approve these setup and ongoing charges.</label>` : ""}`;
  }
  function renderReview() {
    const items = state.reviewItems || [];
    if (!items.length && !state.reviewCursor) return "";
    return `<section class="pt-card"><h3>Messages needing review</h3><p class="pt-muted">Check delivery before taking further action.</p>${items.map((item) => `<div class="pt-row"><span>${e(customerText(item.recipientLabel || item.campaignName || "Message"))} · ${e(customerText(String(item.status || "Needs review").replaceAll("_", " ")))}</span><button type="button" class="pt-btn pt-btn--secondary" data-opt-in-action="review" data-attempt-id="${e(item.attemptId)}"${state.busy || state.uncertain || item.canReconcile !== true ? " disabled" : ""}>Check delivery status</button></div>`).join("")}${state.reviewCursor ? action("review-more", "More messages", state.busy, true) : ""}</section>`;
  }
  function render() {
    if (!state.visible || identity() !== state.key) return "";
    const registration = state.registration,
      settings = state.settings;
    const title =
      settings?.routingMode === "dual"
        ? "Dual stream texting"
        : "Single stream texting";
    const editing = state.editing && mayEdit();
    const canEnable =
      state.enabled &&
      registration?.ready === true &&
      registration.status === "approved";
    return `<section class="pt-card" data-opt-in-key="${e(state.key)}" aria-busy="${state.busy ? "true" : "false"}"><div class="pt-row"><h2>Opt-in texting</h2>${registration ? `<span class="pt-tag">${e(statuses[registration.status])}</span>` : ""}</div>${state.loading ? `<p role="status">Loading texting options…</p>` : `<p><strong>${e(title)}</strong></p>${state.error ? `<p class="pt-notice" role="alert">${e(state.error)}</p>` : ""}${state.notice ? `<p role="status">${e(state.notice)}</p>` : ""}${registration?.reviewMessage ? `<p class="pt-notice">${e(customerText(registration.reviewMessage))}</p>` : ""}${state.uncertain ? `<p class="pt-muted">The saved outcome needs to be checked before another change.</p>` : ""}${editing ? `<form data-opt-in-form><div class="pt-eyebrow">STEP ${state.step + 1} OF 3 · ${e(steps[state.step])}</div><fieldset${locked() ? " disabled" : ""}>${fields()}</fieldset><p role="alert" data-opt-in-validation>${e(state.validation || "")}</p><div class="pt-actions">${action("back", "Back", state.busy || state.step === 0, true)}${action("refresh", "Refresh status", state.busy, true)}${action("save", "Save draft", locked() || !state.capabilities.canSave, true)}${state.step < 2 ? action("next", "Continue", locked()) : `${action("quote", "Check registration charge", locked() || !state.capabilities.canQuote)}${action("submit", "Submit application", locked() || !state.capabilities.canSubmit || !state.quote || !state.chargesAccepted)}`}</div></form>` : `<p class="pt-muted">${registration?.status === "approved" ? "Use recorded opt-in for eligible contacts. Sending stays individual." : "Add a separate application for contacts with recorded opt-in."}</p><div class="pt-actions">${state.enabled && mayEdit() && state.capabilities.canSave ? action("edit", registration ? "Continue application" : "Add opt-in texting", state.busy) : ""}${canEnable && settings?.routingMode !== "dual" ? action("enable", "Enable dual stream texting", state.busy || state.uncertain || Boolean(settings?.pendingRoutingMode)) : ""}${settings?.routingMode === "dual" ? action("single", "Return to single stream texting", state.busy || state.uncertain || Boolean(settings?.pendingRoutingMode), true) : ""}${action("refresh", "Refresh status", state.busy, true)}</div>${!state.enabled ? `<p class="pt-muted">Additional texting setup is not available yet.</p>` : ""}`}${state.quote?.requiresPayment && checkedUrl(state.quote.checkoutUrl) ? `<p><a class="pt-btn" href="${e(checkedUrl(state.quote.checkoutUrl))}" target="_blank" rel="noopener noreferrer">Complete registration payment</a></p>` : ""}${(settings?.notifications || []).map((notification) => `<p role="status" class="pt-notice">${e(customerText(notification.message || notification.title))}</p>`).join("")}${renderReview()}`}</section>`;
  }
  const owns = (target) =>
    target?.closest?.("[data-opt-in-key]")?.dataset.optInKey === state.key &&
    identity() === state.key &&
    context()?.section === "settings";
  function capture(form) {
    if (!form) return;
    const before = JSON.stringify([
      state.application,
      state.token,
      state.expiresOn,
    ]);
    for (const [name, value] of new FormData(form)) {
      if (name === "verificationToken") state.token = String(value).trim();
      else if (name === "verificationExpiresOn")
        state.expiresOn = String(value);
      else if (
        name !== "authorityConfirmed" &&
        applicationFields.includes(name)
      )
        state.application[name] = String(value).trim();
    }
    if (form.elements.namedItem("chargesAccepted"))
      state.chargesAccepted =
        form.elements.namedItem("chargesAccepted").checked;
    if (form.elements.namedItem("authorityConfirmed"))
      state.application.authorityConfirmed =
        form.elements.namedItem("authorityConfirmed").checked;
    if (
      before !==
      JSON.stringify([state.application, state.token, state.expiresOn])
    )
      state.dirty = true;
  }
  function validation(step) {
    return validateOptInStep(state.application, step, {
      hasEin: !!state.registration?.einLast4,
      hasToken: state.registration?.hasVerificationToken,
      token: state.token || "",
      expiresOn: state.expiresOn || "",
    });
  }
  async function save() {
    const body = {
      expectedRevision: state.registration?.revision || 0,
      application: state.application,
      verificationToken: state.token
        ? { action: "replace", token: state.token, expiresOn: state.expiresOn }
        : { action: "preserve" },
    };
    accept(await api("/opt-in-registration", body, "PUT"));
    state.notice = "Draft saved.";
  }
  async function act(name, form, attemptId) {
    if (state.busy || state.loading || (state.uncertain && name !== "refresh"))
      return;
    capture(form);
    if (name === "edit") {
      state.editing = true;
      state.step = 0;
      changed();
      return;
    }
    if (name === "back") {
      state.step = Math.max(0, state.step - 1);
      changed();
      return;
    }
    if (name === "next") {
      state.validation = validation(state.step);
      if (!state.validation) state.step++;
      changed();
      return;
    }
    if (["save", "quote", "submit"].includes(name) && locked()) return;
    if (["quote", "submit"].includes(name)) {
      for (let step = 0; step < 3; step++) {
        const error = validation(step);
        if (error) {
          state.step = step;
          state.validation = error;
          changed();
          return;
        }
      }
    }
    const key = state.key,
      version = generation;
    state.busy = true;
    state.error = "";
    state.notice = "";
    changed();
    let write = false;
    try {
      if (name === "refresh") {
        await read();
        state.notice = "Status refreshed.";
      } else if (name === "review-more" && state.reviewCursor) {
        const result = await api(
          `/review?cursor=${encodeURIComponent(state.reviewCursor)}`,
        );
        state.reviewItems = [
          ...state.reviewItems,
          ...(Array.isArray(result.items) ? result.items : []),
        ];
        state.reviewCursor = result.nextCursor || null;
      } else if (name === "review") {
        if (
          !(state.reviewItems || []).some(
            (item) =>
              item.attemptId === attemptId && item.canReconcile === true,
          )
        )
          return;
        write = true;
        await api(`/review/${encodeURIComponent(attemptId)}/reconcile`, {});
        const result = await api("/review");
        state.reviewItems = Array.isArray(result.items) ? result.items : [];
        state.reviewCursor = result.nextCursor || null;
        state.notice =
          "Delivery status checked. Messages still needing review remain on hold.";
      } else if (name === "save") {
        write = true;
        await save();
      } else if (name === "quote") {
        write = true;
        if (state.dirty) await save();
        const result = await api("/opt-in-registration/quote", {
          expectedRevision: state.registration?.revision || 0,
        });
        state.quote = result.quote;
        state.chargesAccepted = false;
        state.authorizationId = result.authorizationId || null;
        if (result.capabilities) state.capabilities = result.capabilities;
        if (!state.quote)
          throw new Error("A registration charge is not available yet.");
      } else if (name === "submit") {
        if (
          !state.capabilities.canSubmit ||
          !state.quote ||
          state.dirty ||
          !state.chargesAccepted ||
          !state.quote.termsVersion
        )
          throw new Error(
            "Save your latest changes and check the registration charge before submitting.",
          );
        write = true;
        state.submitId ||= crypto.randomUUID();
        const result = await api("/opt-in-registration/submit", {
          expectedRevision: state.registration.revision,
          idempotencyKey: state.submitId,
          quoteId: state.quote.quoteId,
          authorizationId: state.authorizationId,
          chargesAccepted: true,
          termsVersion: state.quote.termsVersion,
        });
        accept(result);
        state.editing = false;
        state.notice =
          "Application submitted. Your current texting service remains available.";
      } else if (["enable", "single"].includes(name)) {
        if (name === "enable" && (!state.enabled || !state.registration?.ready))
          return;
        write = true;
        const result = await api(
          "/settings",
          {
            expectedRevision: state.settings.revision,
            routingMode: name === "enable" ? "dual" : "single",
          },
          "PATCH",
        );
        if (
          !result.settings ||
          !["single", "dual"].includes(result.settings.routingMode)
        )
          throw new Error("Refresh to check the saved texting mode.");
        state.settings = result.settings;
        state.notice = result.settings.pendingRoutingMode
          ? "Preparing your updated texting setup. Refresh status to check progress."
          : name === "single"
            ? "Single stream texting selected. Unsent messages are being prepared."
            : "Dual stream texting enabled.";
      }
    } catch (error) {
      if (active(key, version)) {
        state.error = customerText(
          error.message || "The saved status needs review.",
        );
        if (write) state.uncertain = true;
        if ([401, 403].includes(error.status)) {
          state.visible = false;
          state.application = {};
        }
      }
    } finally {
      if (active(key, version)) {
        state.busy = false;
        changed();
      }
    }
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-opt-in-action]");
    if (target && owns(target) && !target.disabled)
      void act(
        target.dataset.optInAction,
        target.closest("form"),
        target.dataset.attemptId,
      );
  });
  document.addEventListener("submit", (event) => {
    if (event.target.matches?.("[data-opt-in-form]") && owns(event.target))
      event.preventDefault();
  });
  document.addEventListener("input", (event) => {
    if (owns(event.target) && event.target.closest("[data-opt-in-form]")) {
      capture(event.target.form);
      if (event.target.type === "checkbox") changed();
    }
  });
  return { load, render, reset };
}
