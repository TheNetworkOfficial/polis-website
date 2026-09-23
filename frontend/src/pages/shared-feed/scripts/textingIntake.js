import "../css/texting-intake.css";
import guidelinesUrl from "../../../assets/text-banking/polis-website-registration-guidelines.pdf";

export const WEBSITE_GUIDELINES_VERSION = "polis-10dlc-website-2026-09-17";
const EDITABLE = new Set([
  "draft",
  "needs_information",
  "ready_for_handoff",
  "changes_required",
]);
const STATUSES = new Set([
  ...EDITABLE,
  "submitted",
  "pending_provider_review",
  "approved",
  "denied",
]);
const TYPES = {
  public: "Public company",
  private: "Private company",
  nonprofit: "Nonprofit",
  political: "Political organization",
  government: "Government",
};
const STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );
const LABELS = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  legalEntityName: "Legal organization name",
  dba: "Doing business as",
  legalEntityType: "Organization type",
  taxEin: "EIN",
  country: "Country",
  websiteAddress: "Website",
  entityStreetAddress: "Street address",
  entityCity: "City",
  entityState: "State",
  entityZip: "ZIP code",
  filingUrl: "Official filing URL",
  filingInstructions: "Filing navigation instructions",
  useCaseDescription: "How will your organization use texting?",
  sampleMessage1: "Sample message 1",
  sampleMessage2: "Sample message 2",
  sampleMessage3: "Sample message 3",
  areaCode1: "Preferred area code",
  areaCode2: "Second area code",
  listSource: "Where will contact lists come from?",
  permittedPurpose: "Permitted use and source restrictions",
};
const OPTIONAL = new Set([
  "dba",
  "filingUrl",
  "filingInstructions",
  "sampleMessage3",
  "areaCode2",
]);
const STEPS = ["Contact", "Organization", "Messages", "Review"];
const HEADINGS = [
  "Who should we contact?",
  "Your organization.",
  "What will you send?",
  "Ready for review.",
];
const SUBHEADINGS = [
  "Use the person responsible for your organization’s texting.",
  "Use the legal details on your official records.",
  "Show how your organization will reach people.",
  "Confirm your list source and authorize registration review.",
];
const normalize = (value) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const vendorText = (value) =>
  String(value ?? "").replace(/\bPrompt(?:\.io)?(?:'s)?\b/gi, "our vendors");
const emptyFields = () =>
  Object.fromEntries(
    Object.keys(LABELS).map((key) => [key, key === "country" ? "US" : ""]),
  );
export function intakeStepForField(field) {
  if (["email", "firstName", "lastName", "phone"].includes(field)) return 0;
  if (
    [
      "useCaseDescription",
      "sampleMessage1",
      "sampleMessage2",
      "sampleMessage3",
      "areaCode1",
      "areaCode2",
    ].includes(field)
  )
    return 2;
  if (["listSource", "permittedPurpose", "authorityConfirmed"].includes(field))
    return 3;
  return 1;
}
function validUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password &&
      !/[\r\n\t]/.test(value)
    );
  } catch {
    return false;
  }
}
/** Mirrors the existing intake contract. The server remains authoritative. */
export function validateTextingIntake(
  fields,
  {
    authority = false,
    token = "",
    expiresOn = "",
    savedVerify = null,
    now = new Date(),
  } = {},
) {
  const values = Object.fromEntries(
    Object.keys(LABELS).map((key) => [key, normalize(fields[key])]),
  );
  const errors = {};
  for (const [key, label] of Object.entries(LABELS)) {
    if (!OPTIONAL.has(key) && !values[key])
      errors[key] = `${label} is required.`;
    if (
      String(fields[key] ?? "").length > 10000 ||
      // Reject control characters instead of silently altering registration data.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(values[key])
    )
      errors[key] =
        "Remove unsupported characters or shorten this field to 10,000 characters.";
  }
  const check = (key, valid, message) => {
    if (values[key] && !valid) errors[key] = message;
  };
  check(
    "email",
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email),
    "Enter a complete email address.",
  );
  let phone = values.phone.replace(/[ ().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (!phone.startsWith("+"))
    phone = phone.length === 10 ? `+1${phone}` : `+${phone}`;
  check(
    "phone",
    values.phone.length <= 80 &&
      /^(?:\+|00)?[0-9 ().-]+$/.test(values.phone) &&
      /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone),
    "Enter a complete US contact phone number.",
  );
  check("country", values.country === "US", "Select United States.");
  check(
    "taxEin",
    /^(?:\d{9}|\d{2}-\d{7})$/.test(values.taxEin),
    "Enter the complete nine-digit EIN.",
  );
  check(
    "entityState",
    STATES.includes(values.entityState),
    "Select a US state or Washington, DC.",
  );
  check(
    "entityZip",
    /^\d{5}(?:-\d{4})?$/.test(values.entityZip),
    "Enter a five-digit ZIP or complete ZIP+4.",
  );
  check(
    "legalEntityType",
    Object.hasOwn(TYPES, values.legalEntityType),
    "Select an organization type.",
  );
  for (const key of ["websiteAddress", "filingUrl"])
    check(
      key,
      validUrl(values[key]),
      "Enter a complete public HTTP or HTTPS URL.",
    );
  if (values.legalEntityType === "political" && !values.filingUrl)
    errors.filingUrl =
      "An official filing URL is required for political organizations.";
  for (const key of ["areaCode1", "areaCode2"])
    check(key, /^\d{3}$/.test(values[key]), "Enter exactly three digits.");
  for (const key of ["sampleMessage1", "sampleMessage2", "sampleMessage3"])
    check(
      key,
      /\bSTOP\b/i.test(values[key]),
      "Include STOP opt-out instructions.",
    );
  const preserving =
    !token && savedVerify?.hasToken && expiresOn === savedVerify.expiresOn;
  if (
    !preserving &&
    (!token.trim() ||
      token.length > 4096 ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/u.test(token))
  )
    errors["campaignVerify.token"] =
      "Enter the complete Campaign Verify token, not the one-time PIN.";
  const time = Date.parse(`${expiresOn}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== expiresOn ||
    expiresOn <= new Date(now).toISOString().slice(0, 10)
  )
    errors["campaignVerify.expiresOn"] =
      "Enter the token’s actual future expiration date.";
  if (!authority)
    errors.authorityConfirmed =
      "Authorize your organization’s information for registration review.";
  return errors;
}

export function decodeTextingIntake(response) {
  if (
    !response ||
    response.ok !== true ||
    (response.guidelinesVersion &&
      response.guidelinesVersion !== WEBSITE_GUIDELINES_VERSION)
  )
    throw new Error(
      "Registration guidelines changed. Refresh Polis before submitting.",
    );
  const intake = response.intake;
  if (intake == null) return response;
  const verify = intake.campaignVerify;
  if (
    intake.canSend !== false ||
    intake.manualOnly !== true ||
    intake.intakeId !== "registration" ||
    !STATUSES.has(intake.status) ||
    !Number.isSafeInteger(intake.revision) ||
    intake.revision < 1 ||
    intake.packet?.version !== 1 ||
    typeof intake.packet.authorityConfirmed !== "boolean" ||
    Object.hasOwn(intake.packet, "campaignVerify") ||
    Object.keys(LABELS).some(
      (key) =>
        intake.packet[key] != null && typeof intake.packet[key] !== "string",
    ) ||
    (verify != null &&
      (typeof verify.hasToken !== "boolean" ||
        Object.keys(verify).some(
          (key) =>
            !["hasToken", "expiresOn", "lastOperationId", "status"].includes(
              key,
            ),
        ) ||
        (verify.hasToken
          ? typeof verify.expiresOn !== "string"
          : verify.expiresOn != null)))
  )
    throw new Error(
      "Your saved application could not be verified. Refresh its status.",
    );
  return response;
}

/** Registration remains organization-scoped and never enables sending. */
export function createTextingIntakePage({
  request,
  context,
  changed,
  navigate,
}) {
  let view = {};
  let sequence = 0;
  const identity = () => {
    const current = context();
    return current?.organizationId && current?.userId
      ? `${current.userId}:${current.organizationId}`
      : "";
  };
  const active = (key, version) =>
    key === identity() && view.key === key && version === sequence;
  const endpoint = (organizationId) =>
    `/api/text-banking/prompt-intake/${encodeURIComponent(`coalition:${organizationId}`)}`;
  const uuid = () => globalThis.crypto.randomUUID();
  const locked = () =>
    view.working ||
    view.uncertain ||
    Boolean(view.intake && !EDITABLE.has(view.intake.status));
  const errors = () =>
    validateTextingIntake(view.fields || {}, {
      authority: view.authority,
      token: view.token || "",
      expiresOn: view.expiresOn || "",
      savedVerify: view.savedVerify,
    });
  const stepErrors = () =>
    Object.entries(errors()).filter(
      ([key]) => intakeStepForField(key) === view.step,
    );
  function reset() {
    sequence += 1;
    view = {};
  }
  function accept(response) {
    decodeTextingIntake(response);
    const intake = response.intake;
    Object.assign(view, {
      intake,
      fields: {
        ...emptyFields(),
        ...Object.fromEntries(
          Object.keys(LABELS).map((key) => [
            key,
            intake?.packet?.[key] ?? (key === "country" ? "US" : ""),
          ]),
        ),
      },
      authority: intake?.packet.authorityConfirmed === true,
      revision: intake?.revision || 0,
      validation: response.validation,
      token: "",
      expiresOn: intake?.campaignVerify?.expiresOn || "",
      savedVerify: intake?.campaignVerify || null,
      verifyOperationId: null,
      dirty: false,
      uncertain: null,
      latestSaved: null,
      error: "",
      websiteConfirmed: false,
      showGuidelines: false,
      touched: new Set(),
    });
  }
  async function load({ force = false } = {}) {
    const key = identity();
    if (!key) {
      reset();
      return;
    }
    if (view.key === key && !force && (view.loading || view.loaded)) return;
    if (view.key === key && (view.dirty || view.uncertain) && force)
      return checkSaved();
    reset();
    const version = sequence;
    view = { key, loading: true, step: 0, started: false };
    changed();
    try {
      const response = decodeTextingIntake(
        await request(endpoint(context().organizationId), { auth: true }),
      );
      if (!active(key, version)) return;
      accept(response);
      view.started = Boolean(response.intake);
      view.loaded = true;
    } catch {
      if (active(key, version))
        view.error =
          "Your application could not be loaded. An organization administrator can refresh to check access.";
    } finally {
      if (active(key, version)) {
        view.loading = false;
        changed();
      }
    }
  }
  function packet() {
    const replacing =
      view.token || view.expiresOn !== (view.savedVerify?.expiresOn || "");
    if (replacing && !view.verifyOperationId) view.verifyOperationId = uuid();
    return {
      version: 1,
      ...view.fields,
      authorityConfirmed: view.authority,
      ...(replacing
        ? {
            campaignVerify: {
              action: "replace",
              token: view.token,
              expiresOn: view.expiresOn,
              operationId: view.verifyOperationId,
            },
          }
        : {}),
    };
  }
  function matchesSaved(saved) {
    if (!saved) return false;
    const verify = saved.campaignVerify;
    const verifyMatches = view.verifyOperationId
      ? verify?.lastOperationId === view.verifyOperationId &&
        verify?.hasToken === true &&
        verify.expiresOn === view.expiresOn
      : Boolean(verify?.hasToken) === Boolean(view.savedVerify?.hasToken) &&
        (verify?.expiresOn || "") === (view.savedVerify?.expiresOn || "") &&
        (verify?.lastOperationId || null) ===
          (view.savedVerify?.lastOperationId || null);
    return (
      verifyMatches &&
      saved.packet.authorityConfirmed === view.authority &&
      Object.keys(LABELS).every(
        (key) => normalize(saved.packet[key]) === normalize(view.fields[key]),
      )
    );
  }
  async function saveDraft() {
    if (locked() || !view.loaded || identity() !== view.key) return false;
    const replacing =
      view.token || view.expiresOn !== (view.savedVerify?.expiresOn || "");
    const fieldErrors = errors();
    if (
      replacing &&
      (fieldErrors["campaignVerify.token"] ||
        fieldErrors["campaignVerify.expiresOn"])
    ) {
      view.error =
        fieldErrors["campaignVerify.token"] ||
        fieldErrors["campaignVerify.expiresOn"];
      view.step = 1;
      changed();
      return false;
    }
    const key = view.key,
      version = sequence,
      path = endpoint(context().organizationId);
    const input = { expectedRevision: view.revision, packet: packet() };
    view.working = true;
    view.error = "";
    changed();
    try {
      const response = decodeTextingIntake(
        await request(path, { auth: true, method: "PUT", body: input }),
      );
      if (!active(key, version)) return false;
      if (!response.intake) throw new Error("Missing saved draft");
      accept(response);
      view.notice = "Draft saved";
      return true;
    } catch {
      if (active(key, version)) {
        view.uncertain = "save";
        view.error =
          "Save not confirmed. Your edits are still here. Check the saved copy before trying again.";
      }
      return false;
    } finally {
      if (active(key, version)) {
        view.working = false;
        changed();
      }
    }
  }
  async function checkSaved() {
    if (view.working || identity() !== view.key) return;
    const key = view.key,
      version = sequence;
    view.working = true;
    view.error = "";
    changed();
    try {
      const response = decodeTextingIntake(
        await request(endpoint(context().organizationId), { auth: true }),
      );
      if (!active(key, version)) return;
      if (
        response.intake &&
        (!EDITABLE.has(response.intake.status) || matchesSaved(response.intake))
      ) {
        accept(response);
        view.notice = "Saved status checked";
      } else if (!response.intake && view.revision === 0) {
        view.uncertain = null;
        view.error =
          "No saved draft was returned. Your edits are ready to save.";
      } else {
        view.latestSaved = response;
        view.uncertain = "conflict";
        view.error =
          "The saved copy differs from your edits. Review it before replacing your current changes.";
      }
    } catch {
      if (active(key, version))
        view.error =
          "The saved copy could not be checked. Your edits remain here.";
    } finally {
      if (active(key, version)) {
        view.working = false;
        changed();
      }
    }
  }
  function submissionKey() {
    const storageKey = `polis.textingIntake.submit:${encodeURIComponent(view.key)}:${view.revision}`;
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (/^[0-9a-f-]{36}$/i.test(existing || "")) return existing;
      const value = uuid();
      sessionStorage.setItem(storageKey, value);
      return value;
    } catch {
      if (view.submissionKeyRevision !== view.revision) {
        view.submissionKeyRevision = view.revision;
        view.submissionKey = uuid();
      }
      return view.submissionKey;
    }
  }
  async function submit() {
    if (locked() || !view.websiteConfirmed || Object.keys(errors()).length)
      return;
    const key = view.key,
      version = sequence;
    // Submit is one customer action: save the current complete packet first.
    if ((view.dirty || !view.revision) && !(await saveDraft())) return;
    if (!active(key, version)) return;
    const idempotencyKey = submissionKey();
    view.working = true;
    view.error = "";
    view.showGuidelines = false;
    changed();
    try {
      const response = decodeTextingIntake(
        await request(`${endpoint(context().organizationId)}/submit`, {
          auth: true,
          method: "POST",
          body: {
            expectedRevision: view.revision,
            idempotencyKey,
            websiteAcknowledgment: {
              version: WEBSITE_GUIDELINES_VERSION,
              confirmed: true,
            },
          },
        }),
      );
      if (!active(key, version)) return;
      if (!response.intake || EDITABLE.has(response.intake.status))
        throw new Error("Submission not confirmed");
      accept(response);
    } catch {
      if (active(key, version)) {
        view.uncertain = "submit";
        view.error =
          "Submission not confirmed. Check its saved status before trying again.";
      }
    } finally {
      if (active(key, version)) {
        view.working = false;
        changed();
      }
    }
  }
  function field(
    name,
    { wide = false, textarea = false, type = "text", hint = "" } = {},
  ) {
    const fieldErrors = errors(),
      value = view.fields[name] || "";
    const message = view.touched.has(name) ? fieldErrors[name] || "" : "";
    const optional =
      OPTIONAL.has(name) &&
      !(name === "filingUrl" && view.fields.legalEntityType === "political");
    const attributes = `id="intake-${name}" data-intake-field="${name}" aria-describedby="intake-error-${name}" ${locked() ? "disabled" : ""}`;
    const choices =
      name === "legalEntityType"
        ? TYPES
        : name === "entityState"
          ? Object.fromEntries(STATES.map((state) => [state, state]))
          : name === "country"
            ? { US: "United States" }
            : null;
    const input = choices
      ? `<select ${attributes}><option value="">Select</option>${Object.entries(
          choices,
        )
          .map(
            ([id, label]) =>
              `<option value="${id}" ${value === id ? "selected" : ""}>${label}</option>`,
          )
          .join("")}</select>`
      : textarea
        ? `<textarea ${attributes} rows="3" maxlength="10000">${escape(value)}</textarea>`
        : `<input ${attributes} type="${type}" value="${escape(value)}" maxlength="10000" autocomplete="off">`;
    return `<label class="pt-field ${wide ? "pt-wide" : ""}" for="intake-${name}"><span>${LABELS[name]}${optional ? " <small>· optional</small>" : ""}</span>${input}${hint ? `<small>${hint}</small>` : ""}<small class="pt-intake-error" id="intake-error-${name}">${escape(message)}</small></label>`;
  }
  const button = (action, label, disabled = false, secondary = false) =>
    `<button type="button" class="pt-btn ${secondary ? "pt-btn--secondary" : ""}" data-intake-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
  const guidelinesLink = () =>
    `<a class="pt-intake-link" href="${escape(guidelinesUrl)}" target="_blank" rel="noopener noreferrer">View website guidelines <span aria-hidden="true">↗</span></a>`;
  function details(intake) {
    return `<details class="pt-intake-details"><summary>View saved application</summary><dl class="pt-intake-readback">${Object.entries(
      LABELS,
    )
      .filter(([key]) => intake.packet[key])
      .map(
        ([key, label]) =>
          `<div><dt>${label}</dt><dd>${escape(intake.packet[key])}</dd></div>`,
      )
      .join(
        "",
      )}<div><dt>Campaign Verify</dt><dd>${intake.campaignVerify?.hasToken ? `Token stored securely · expires ${escape(intake.campaignVerify.expiresOn)}` : "Token not saved"}</dd></div><div><dt>Sharing authorization</dt><dd>${intake.packet.authorityConfirmed ? "Confirmed" : "Not confirmed"}</dd></div></dl></details>`;
  }
  function status() {
    const intake = view.intake;
    const approved = intake.status === "approved",
      denied = intake.status === "denied";
    const title = approved
      ? "Registration approved."
      : denied
        ? "Registration needs attention."
        : "You’re in review.";
    const message = approved
      ? "Your registration is approved. Service activation is a separate step."
      : denied
        ? "Contact the Polis team for the next steps."
        : intake.status === "submitted"
          ? "Polis received your application. We’ll review it and share it with our vendors."
          : "Your application is with our vendors for verification.";
    return `<header class="pt-page-head"><div><div class="pt-eyebrow">REGISTRATION</div><h1>${title}</h1><p>${message}</p></div></header><section class="pt-card pt-intake-status"><div class="pt-intake-status-icon" aria-hidden="true">${approved ? "✓" : denied ? "!" : "◷"}</div><h2>${approved ? "One step closer." : denied ? "Let’s review the next step." : "We’ll take it from here."}</h2><p class="pt-muted">${approved ? "Open the workspace to check your service and funding." : denied ? "Your application remains saved." : "Refresh here for updates. Messaging stays paused during setup."}</p>${intake.submittedAt ? `<p class="pt-muted">Submitted ${escape(new Date(intake.submittedAt).toLocaleDateString())}</p>` : ""}${intake.reviewMessage ? `<p class="pt-notice">${escape(vendorText(intake.reviewMessage))}</p>` : ""}<div class="pt-actions">${approved ? button("home", "Open texting workspace") : ""}${button("refresh", "Refresh status", view.working, true)}</div></section><section class="pt-card">${details(intake)}${guidelinesLink()}</section>`;
  }
  function settings() {
    const intake = view.intake;
    const label =
      {
        approved: "Approved",
        denied: "Not approved",
        submitted: "Received",
        pending_provider_review: "In review",
        changes_required: "Changes needed",
        ready_for_handoff: "Ready to submit",
      }[intake?.status] || (intake ? "Draft" : "Not started");
    return `<header class="pt-page-head"><div><div class="pt-eyebrow">TEXTING SETTINGS</div><h1>The essentials, in one place.</h1><p>Registration details for your organization.</p></div></header><div class="pt-grid pt-grid--two"><section class="pt-card"><h2>Registration</h2><div class="pt-row"><strong>${escape(intake?.packet.legalEntityName || context()?.organizationName || "Your organization")}</strong><span class="pt-tag">${label}</span></div>${intake ? `<div class="pt-row"><span>Campaign Verify</span><span>${intake.campaignVerify?.hasToken ? `Stored securely<br><small>Expires ${escape(intake.campaignVerify.expiresOn)}</small>` : "Not saved"}</span></div><div class="pt-row"><span>Registration contact</span><span>${escape(`${intake.packet.firstName || ""} ${intake.packet.lastName || ""}`)}<br><small>${escape(intake.packet.email)}</small></span></div>${details(intake)}` : ""}<div class="pt-actions">${button("registration", intake && !EDITABLE.has(intake.status) ? "View registration" : "Continue registration", false, true)}</div>${guidelinesLink()}</section><section class="pt-card"><h2>Texting service</h2><div class="pt-row"><span>Messaging mode</span><strong>Individual manual send</strong></div><p class="pt-muted">Service activation, approved numbers and funding are checked separately from registration.</p>${button("home", "View service status", false, true)}<div class="pt-actions">${button("balance", "Texting balance", false, true)}<a href="/texting-payment-terms" class="pt-intake-link">Payment terms</a></div></section></div>`;
  }
  function start() {
    return `<header class="pt-page-head"><div><div class="pt-eyebrow">TEXTING</div><h1>Let’s get your team texting.</h1><p>A few details now. Conversations come next.</p></div></header><section class="pt-card pt-intake-start"><div class="pt-eyebrow">GET READY</div><h2>Register your organization.</h2><p class="pt-muted">Keep your legal details, Campaign Verify token and website handy.</p><ol class="pt-intake-path"><li><strong>Your details</strong><span>Contact, organization and sample messages</span></li><li><strong>Registration review</strong><span>Polis shares your packet with our vendors</span></li><li><strong>Activate texting</strong><span>Service setup and funding come after approval</span></li></ol>${button("start", "Start registration")}</section>`;
  }
  function wizard() {
    const fields =
      view.step === 0
        ? field("firstName") +
          field("lastName") +
          field("email", { type: "email" }) +
          field("phone", {
            type: "tel",
            hint: "US number, including area code.",
          })
        : view.step === 1
          ? field("legalEntityName") +
            field("dba") +
            field("legalEntityType") +
            field("taxEin") +
            field("country") +
            field("websiteAddress", { type: "url" }) +
            field("entityStreetAddress", { wide: true }) +
            field("entityCity") +
            field("entityState") +
            field("entityZip") +
            `<h3 class="pt-wide">Campaign verification</h3>` +
            field("filingUrl", { wide: true, type: "url" }) +
            field("filingInstructions", { wide: true }) +
            `<label class="pt-field pt-wide"><span>Campaign Verify token</span><input data-intake-field="campaignVerify.token" type="password" autocomplete="new-password" maxlength="4096" value="${escape(view.token)}" placeholder="${view.savedVerify?.hasToken ? "Saved securely · leave blank to keep" : "Complete authorization token"}" ${locked() ? "disabled" : ""}><small>${view.savedVerify?.hasToken ? "Saved tokens are never displayed. Enter a replacement only if needed." : "Use the full token, not the one-time PIN."}</small><small class="pt-intake-error" id="intake-error-campaignVerify.token">${escape(view.touched.has("campaignVerify.token") ? errors()["campaignVerify.token"] || "" : "")}</small></label><label class="pt-field"><span>Token expiration date</span><input data-intake-field="campaignVerify.expiresOn" type="date" value="${escape(view.expiresOn)}" ${locked() ? "disabled" : ""}><small>Must be in the future.</small><small class="pt-intake-error" id="intake-error-campaignVerify.expiresOn">${escape(view.touched.has("campaignVerify.expiresOn") ? errors()["campaignVerify.expiresOn"] || "" : "")}</small></label>`
          : view.step === 2
            ? field("useCaseDescription", { textarea: true, wide: true }) +
              `<p class="pt-muted pt-wide">Each sample must identify your organization, include its website and explain how to opt out with STOP.</p>` +
              field("sampleMessage1", { textarea: true, wide: true }) +
              field("sampleMessage2", { textarea: true, wide: true }) +
              `<details class="pt-wide pt-intake-details"><summary>Add a third sample · optional</summary>${field("sampleMessage3", { textarea: true })}</details>` +
              field("areaCode1", {
                hint: "Three digits. Availability may vary.",
              }) +
              field("areaCode2")
            : field("listSource", { textarea: true, wide: true }) +
              field("permittedPurpose", { textarea: true, wide: true }) +
              `<label class="pt-intake-check pt-wide"><input type="checkbox" data-intake-field="authorityConfirmed" ${view.authority ? "checked" : ""} ${locked() ? "disabled" : ""}><span>I authorize Polis to share my organization’s information with its vendors for registration review and submission, and I have authority to give this authorization on behalf of my organization.</span></label><details class="pt-wide pt-intake-details"><summary>Review the details you entered</summary><dl class="pt-intake-readback">${Object.entries(
                LABELS,
              )
                .filter(([key]) => view.fields[key])
                .map(
                  ([key, label]) =>
                    `<div><dt>${label}</dt><dd>${escape(view.fields[key])}</dd></div>`,
                )
                .join(
                  "",
                )}<div><dt>Campaign Verify</dt><dd>${view.token ? "Token entered" : view.savedVerify?.hasToken ? "Token stored securely" : "Token required"} · ${escape(view.expiresOn)}</dd></div></dl></details>`;
    return `<header class="pt-page-head"><div><div class="pt-eyebrow">REGISTRATION · STEP ${view.step + 1} OF 4</div><h1>${HEADINGS[view.step]}</h1><p>${SUBHEADINGS[view.step]}</p></div></header><ol class="pt-intake-steps" aria-label="Registration steps">${STEPS.map((label, index) => `<li ${index === view.step ? 'aria-current="step"' : ""} class="${index < view.step ? "is-complete" : ""}"><span>${index < view.step ? "✓" : index + 1}</span>${label}</li>`).join("")}</ol>${view.intake?.status === "changes_required" && view.intake.reviewMessage ? `<p class="pt-notice">${escape(vendorText(view.intake.reviewMessage))}</p>` : ""}<section class="pt-card"><div class="pt-fields">${fields}</div><p class="pt-intake-validation" data-intake-step-error>${escape(stepErrors()[0]?.[1] || "")}</p><div class="pt-intake-footer">${button("back", "Back", view.working || view.step === 0, true)}<div class="pt-actions">${button("save", view.working ? "Saving…" : "Save draft", locked() || (!view.dirty && view.revision > 0), true)}${view.step < 3 ? button("next", "Continue", locked() || stepErrors().length > 0) : button("review", "Submit application", locked() || Object.keys(errors()).length > 0)}</div></div><p class="pt-muted pt-intake-save-note">${view.dirty ? "Unsaved changes" : view.revision ? "Draft saved" : "Save draft to keep your progress."}</p></section>`;
  }
  function guidelines() {
    return `<section class="pt-card pt-intake-stop" role="region" aria-label="Website readiness"><div class="pt-eyebrow">BEFORE YOU SUBMIT</div><h2>STOP — Is your website ready?</h2><p>Carriers inspect your website. Make sure these are live and public:</p><ul><li>Phone collection forms with optional phone fields and unchecked opt-in choices</li><li>Privacy Policy with the required messaging and data-sharing disclosures</li><li>Terms and Conditions with messaging, STOP and HELP details</li></ul>${guidelinesLink()}<label class="pt-intake-check"><input type="checkbox" data-intake-field="websiteConfirmed" ${view.websiteConfirmed ? "checked" : ""}><span>I reviewed the Polis guidelines and confirm our website is ready for inspection.</span></label><p class="pt-muted">Submission goes to Polis for staff review and vendor handoff. It does not start messaging or purchase verification.</p><div class="pt-actions">${button("cancel-review", "Back to application", view.working, true)}${button("submit", "Submit for review", view.working || !view.websiteConfirmed)}</div></section>`;
  }
  function render() {
    if (!identity() || identity() !== view.key)
      return `<p class="pt-muted">Sign in to view your organization’s registration.</p>`;
    const error = view.error
      ? `<div class="pt-notice" role="alert">${escape(view.error)}${view.uncertain ? `<div class="pt-actions">${button("check-saved", view.uncertain === "submit" ? "Check submission status" : "Check saved copy", view.working, true)}</div>` : ""}</div>`
      : "";
    if (!view.loaded)
      return `<div data-intake-root="${escape(view.key)}">${error}<section class="pt-card"><p>${view.loading ? "Loading registration…" : "Registration is unavailable."}</p>${!view.loading ? button("refresh", "Refresh application") : ""}</section></div>`;
    return `<div class="pt-intake" data-intake-root="${escape(view.key)}">${error}${view.notice ? `<p role="status" class="pt-muted" data-intake-notice>${escape(view.notice)}</p>` : ""}${view.latestSaved ? `<section class="pt-card"><h2>Saved copy</h2>${view.latestSaved.intake ? details(view.latestSaved.intake) : "<p>No saved copy exists.</p>"}<p class="pt-muted">Loading this copy replaces your current unsaved edits.</p>${button("load-saved", "Replace my edits with saved copy", view.working, true)}</section>` : ""}${context().section === "settings" ? settings() : view.showGuidelines ? guidelines() : view.intake && !EDITABLE.has(view.intake.status) ? status() : !view.started ? start() : wizard()}</div>`;
  }
  function eventScope(target) {
    return (
      target?.closest?.("[data-intake-root]")?.dataset.intakeRoot ===
        view.key && identity() === view.key
    );
  }
  function updateControls() {
    const root = document.querySelector("[data-intake-root]");
    if (!root || !eventScope(root)) return;
    for (const action of ["next", "review", "save", "submit"]) {
      const element = root.querySelector(`[data-intake-action="${action}"]`);
      if (element)
        element.disabled = Boolean(
          locked() ||
            (action === "next"
              ? stepErrors().length
              : action === "review"
                ? Object.keys(errors()).length
                : action === "submit"
                  ? !view.websiteConfirmed
                  : false),
        );
    }
    const stepError = root.querySelector("[data-intake-step-error]");
    if (stepError) stepError.textContent = stepErrors()[0]?.[1] || "";
    for (const name of view.touched) {
      const message = document.getElementById(`intake-error-${name}`);
      if (message && root.contains(message))
        message.textContent = errors()[name] || "";
    }
    const note = root.querySelector(".pt-intake-save-note");
    if (note) note.textContent = view.dirty ? "Unsaved changes" : "Draft saved";
    const notice = root.querySelector("[data-intake-notice]");
    if (notice) {
      notice.textContent = view.notice || "";
      notice.hidden = !view.notice;
    }
  }
  function edit(event) {
    const target = event.target,
      name = target?.dataset?.intakeField;
    if (!name || !eventScope(target) || locked()) return;
    if (name === "websiteConfirmed") {
      view.websiteConfirmed = target.checked;
      updateControls();
      return;
    }
    if (name === "authorityConfirmed") view.authority = target.checked;
    else if (name === "campaignVerify.token") {
      view.token = target.value;
      view.verifyOperationId = null;
    } else if (name === "campaignVerify.expiresOn") {
      view.expiresOn = target.value;
      view.verifyOperationId = null;
    } else if (Object.hasOwn(LABELS, name)) view.fields[name] = target.value;
    else return;
    view.touched.add(name);
    view.dirty = true;
    view.notice = "";
    view.validation = null;
    view.websiteConfirmed = false;
    if (name === "legalEntityType" && event.type === "change") changed();
    else updateControls();
  }
  document.addEventListener("input", edit);
  document.addEventListener("change", edit);
  document.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-intake-action]");
    if (!target || target.disabled || !eventScope(target)) return;
    event.preventDefault();
    const action = target.dataset.intakeAction;
    if (["home", "balance", "registration"].includes(action)) {
      navigate(action);
      return;
    }
    if (action === "refresh") {
      load({ force: true });
      return;
    }
    if (action === "check-saved") {
      checkSaved();
      return;
    }
    if (action === "save") {
      saveDraft();
      return;
    }
    if (action === "submit") {
      submit();
      return;
    }
    if (view.working) return;
    if (action === "start") view.started = true;
    if (action === "back" && view.step > 0) view.step -= 1;
    if (action === "next" && !locked() && !stepErrors().length && view.step < 3)
      view.step += 1;
    if (action === "review" && !locked() && !Object.keys(errors()).length) {
      view.showGuidelines = true;
      view.websiteConfirmed = false;
    }
    if (action === "cancel-review") {
      view.showGuidelines = false;
      view.websiteConfirmed = false;
    }
    if (action === "load-saved" && view.latestSaved) {
      accept(view.latestSaved);
      view.started = true;
    }
    changed();
  });
  return {
    load,
    render,
    reset,
    getMeta: () =>
      identity() === view.key
        ? {
            organizationName:
              view.intake?.packet?.legalEntityName ||
              context()?.organizationName ||
              "",
            registrationStatus: view.intake?.status || null,
          }
        : {},
  };
}
