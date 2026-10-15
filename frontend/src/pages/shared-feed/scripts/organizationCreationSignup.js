import { escapeText as e } from "./textingWorkspaceUi";

const STORAGE_KEY = "polis.organizationSignup.v1";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const text = (value) => String(value ?? "").trim();
const tokenValid = (value) => /^[A-Za-z0-9_-]{32,128}$/.test(value || "");
const kinds = [
  "coalition",
  "pac",
  "state_party",
  "county_party",
  "candidate_support",
];
const kindOf = (value) => (kinds.includes(value) ? value : "coalition");
const copy = (value) => JSON.parse(JSON.stringify(value));
const selected = (value, choice) => (value === choice ? " selected" : "");
const https = (value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Mirrors the native organization/legal-profile contract; authorization stays on the server. */
export function organizationSignupPayload(form) {
  const get = (name) => text(form.get(name));
  const orgKind = kindOf(get("orgKind"));
  const pacAssociated =
    orgKind === "pac" ||
    (!["state_party", "county_party"].includes(orgKind) &&
      get("pacAssociated") === "true");
  const classification =
    orgKind === "state_party"
      ? "state_party_committee"
      : orgKind === "county_party"
        ? "county_party_committee"
        : pacAssociated
          ? "other_political_committee"
          : get("committeeClassification");
  const registrationStatus =
    classification === "non_political_organization"
      ? get("registrationStatus") || "registered"
      : "registered";
  const legalEntityProfile = {
    legalName: get("legalName"),
    ein: get("ein").replace(/[^0-9]/g, ""),
    committeeClassification: classification,
    address: {
      line1: get("addressLine1"),
      line2: get("addressLine2"),
      city: get("city"),
      region: get("region").toUpperCase(),
      postalCode: get("postalCode"),
      country: "US",
    },
    authorizedRepresentative: {
      firstName: get("representativeFirstName"),
      lastName: get("representativeLastName"),
      title: get("representativeTitle"),
      email: get("representativeEmail"),
      phone: get("representativePhone"),
    },
    electionRegistration:
      registrationStatus === "not_applicable"
        ? {
            registrationStatus,
            notApplicableReason: get("notApplicableReason"),
          }
        : {
            registrationStatus,
            authorityName: get("authorityName"),
            registrationId: get("registrationId"),
            filingUrl: get("filingUrl"),
          },
    websiteUrl: get("websiteUrl"),
  };
  const stateId = get("stateId").toUpperCase(),
    countyName = get("countyName"),
    districtId = get("districtId");
  const jurisdiction = [
    "state_party",
    "county_party",
    "candidate_support",
  ].includes(orgKind)
    ? {
        level: {
          state_party: "state",
          county_party: "county",
          candidate_support: "district",
        }[orgKind],
        stateId,
        ...(get("stateName") ? { stateName: get("stateName") } : {}),
      }
    : {};
  if (orgKind === "county_party")
    Object.assign(jurisdiction, {
      countyName,
      countyId: `${stateId}-${countyName
        .replace(/\bcounty\b/gi, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`,
    });
  if (orgKind === "candidate_support")
    Object.assign(jurisdiction, {
      districtId,
      districtName: get("districtName"),
    });
  const party = ["state_party", "county_party"].includes(orgKind)
    ? {
        partyId: get("partyAbbrev").toUpperCase(),
        label: get("partyLabel"),
        abbrev: get("partyAbbrev").toUpperCase(),
        committeeId: get("committeeId"),
      }
    : {};
  const coalitionType =
    orgKind === "coalition" ? get("coalitionType") || "simple" : "simple";
  return {
    name: get("name"),
    description: get("description"),
    imageUrl: get("imageUrl"),
    coalitionType,
    pacAssociated,
    fecNumber: pacAssociated ? get("fecNumber") : null,
    primaryContactName:
      `${legalEntityProfile.authorizedRepresentative.firstName} ${legalEntityProfile.authorizedRepresentative.lastName}`.trim(),
    phone: legalEntityProfile.authorizedRepresentative.phone,
    email: legalEntityProfile.authorizedRepresentative.email,
    website: legalEntityProfile.websiteUrl,
    orgKind,
    governanceType: orgKind === "coalition" ? coalitionType : orgKind,
    jurisdiction,
    party,
    districtScope:
      orgKind === "candidate_support"
        ? { stateId, districtId, districtName: get("districtName") }
        : {},
    legalEntityProfile,
    socials: Object.fromEntries(
      ["facebook", "threads", "bluesky", "instagram", "tiktok"]
        .map((key) => [key, get(`social:${key}`)])
        .filter(([, value]) => value),
    ),
  };
}

export function validateOrganizationSignup(body) {
  const legal = body.legalEntityProfile,
    rep = legal.authorizedRepresentative,
    address = legal.address,
    registration = legal.electionRegistration;
  if (
    ![
      body.name,
      body.description,
      body.imageUrl,
      legal.legalName,
      ...["line1", "city", "region", "postalCode"].map((key) => address[key]),
      ...["firstName", "lastName", "title", "email", "phone"].map(
        (key) => rep[key],
      ),
    ].every(Boolean)
  )
    return "Complete the organization and legal details.";
  if (!https(body.imageUrl) || !https(legal.websiteUrl))
    return "Use secure https links for the image and website.";
  if (!/^\d{9}$/.test(legal.ein)) return "Enter the nine-digit EIN.";
  if (
    !/^[A-Z]{2}$/.test(address.region) ||
    !/^\d{5}(?:-\d{4})?$/.test(address.postalCode)
  )
    return "Check the legal address state and ZIP code.";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rep.email) ||
    !/^\+[1-9]\d{7,14}$/.test(rep.phone)
  )
    return "Check the representative email and phone, including country code.";
  if (
    ![
      "state_party_committee",
      "county_party_committee",
      "candidate_committee",
      "other_political_committee",
      "non_political_organization",
    ].includes(legal.committeeClassification)
  )
    return "Choose the legal organization classification.";
  if (
    registration.registrationStatus === "registered" &&
    (!registration.authorityName ||
      !registration.registrationId ||
      !https(registration.filingUrl))
  )
    return "Complete the registration authority, filing number, and secure filing link.";
  if (
    registration.registrationStatus === "not_applicable" &&
    (legal.committeeClassification !== "non_political_organization" ||
      registration.notApplicableReason.length < 10)
  )
    return "Explain why election registration does not apply.";
  if (body.pacAssociated && !body.fecNumber) return "Enter the PAC FEC number.";
  if (
    ["state_party", "county_party", "candidate_support"].includes(
      body.orgKind,
    ) &&
    !/^[A-Z]{2}$/.test(body.jurisdiction.stateId)
  )
    return "Choose the organization state.";
  if (
    ["state_party", "county_party"].includes(body.orgKind) &&
    (!body.party.label || !body.party.abbrev)
  )
    return "Enter the party name and abbreviation.";
  if (body.orgKind === "county_party" && !body.jurisdiction.countyName)
    return "Enter the county name.";
  return "";
}

/** A tab-scoped intent is a return path, never a permission grant. No legal form data is persisted. */
export function createOrganizationSignup({
  request,
  context,
  changed,
  navigate,
  clearDraft = () => {},
  storage,
  now = Date.now,
  uuid = () => crypto.randomUUID(),
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let intent = null,
    generation = 0,
    active = null,
    frozenPayload = null,
    owner = "";
  let view = {
    phase: "required",
    message: "Open the organization invitation sent to you to continue.",
    canRetry: false,
  };
  const key = () => {
    const current = context();
    return current?.actorId && current?.path
      ? `${current.actorId}:${current.path}`
      : "";
  };
  const usable = (value) =>
    tokenValid(value?.invitationToken) &&
    /^[A-Za-z0-9_-]{1,100}$/.test(value?.clientRequestId || "") &&
    now() - value?.savedAt >= 0 &&
    now() - value?.savedAt < RETENTION_MS;
  const read = () => {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      if (usable(value)) return value;
      storage.removeItem(STORAGE_KEY);
      return null;
    } catch {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* Storage may be unavailable. */
      }
      return null;
    }
  };
  const save = () => storage.setItem(STORAGE_KEY, JSON.stringify(intent));
  const forget = () => {
    intent = null;
    frozenPayload = null;
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* A residual intent still requires fresh server validation. */
    }
  };
  const update = (values) => {
    view = { ...view, ...values };
    changed();
  };
  function reset() {
    generation++;
    active?.abort();
    active = null;
    frozenPayload = null;
    owner = "";
    clearDraft();
    view = {
      phase: "required",
      message: "Open the organization invitation sent to you to continue.",
      canRetry: false,
    };
  }
  function captureLocation(href, replace) {
    const url = new URL(href),
      parameters = [...url.searchParams.entries()].filter(
        ([name]) => name.toLowerCase() === "invitationtoken",
      );
    if (
      !["/organizations/signup", "/coalitions/start"].includes(
        url.pathname.replace(/\/$/, ""),
      )
    )
      return;
    if (parameters.length) {
      for (const [name] of parameters) url.searchParams.delete(name);
      replace(url.pathname + url.search + url.hash);
      reset();
      const token = parameters.length === 1 ? parameters[0][1].trim() : "";
      if (!tokenValid(token)) {
        forget();
        update({
          phase: "blocked",
          message: "This invitation link is invalid. Ask for a new invitation.",
        });
        return;
      }
      const stored = read();
      intent =
        stored?.invitationToken === token
          ? stored
          : {
              invitationToken: token,
              clientRequestId: uuid(),
              savedAt: now(),
              orgKind: kindOf(url.searchParams.get("orgKind")),
              actorId: null,
              creationStarted: false,
            };
      try {
        save();
      } catch {
        forget();
        update({
          phase: "blocked",
          message:
            "This browser could not save the invitation. Sign in, then open the invitation again.",
        });
      }
    } else intent ||= read();
  }
  function guard(snapshot, version, signal) {
    if (
      !snapshot ||
      snapshot !== key() ||
      version !== generation ||
      signal?.aborted
    )
      throw new Error("organization_signup_context_changed");
  }
  async function call(path, body, timeout, snapshot, version) {
    const controller = new AbortController();
    active = controller;
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          guard(snapshot, version, controller.signal);
          return request(path, {
            auth: true,
            method: "POST",
            body: copy(body),
            signal: controller.signal,
            beforeRequest: () => guard(snapshot, version, controller.signal),
          });
        }),
        new Promise((_, reject) => {
          timer = schedule(() => {
            controller.abort();
            reject(
              Object.assign(new Error("organization_signup_timeout"), {
                timeout: true,
              }),
            );
          }, timeout);
        }),
      ]);
    } finally {
      cancel(timer);
      if (active === controller) active = null;
    }
  }
  function finish(coalitionId) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(coalitionId || ""))
      throw new Error("organization_signup_response_invalid");
    forget();
    clearDraft();
    navigate(`/coalitions/${encodeURIComponent(coalitionId)}`);
  }
  async function load({ force = false } = {}) {
    const snapshot = key();
    if (!snapshot) return;
    if (intent && !usable(intent)) {
      forget();
      reset();
      changed();
      return;
    }
    if (
      !force &&
      owner === snapshot &&
      ["checking", "form", "creating", "uncertain", "blocked"].includes(
        view.phase,
      )
    )
      return;
    if (owner && owner !== snapshot) reset();
    intent ||= read();
    owner = snapshot;
    if (!intent) return;
    if (intent.actorId && intent.actorId !== context().actorId) {
      forget();
      update({
        phase: "blocked",
        message:
          "This invitation belongs to a different signed-in account. Open your invitation after switching accounts.",
      });
      return;
    }
    const version = ++generation;
    update({
      phase: "checking",
      message: "Checking your invitation…",
      canRetry: false,
      requiresSignIn: false,
    });
    try {
      const response = await call(
        "/api/organization-creation-invitations/validate",
        { invitationToken: intent.invitationToken },
        20000,
        snapshot,
        version,
      );
      guard(snapshot, version);
      const invitation = response?.invitation,
        expires = Date.parse(invitation?.expiresAt);
      if (
        response?.ok !== true ||
        !["pending", "redeemed"].includes(invitation?.status) ||
        !Number.isFinite(expires) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitation?.recipientEmail || "")
      )
        throw new Error("organization_signup_response_invalid");
      if (invitation.status === "redeemed") {
        finish(invitation.redeemedCoalitionId);
        return;
      }
      if (expires <= now())
        throw Object.assign(new Error("organization_signup_expired"), {
          status: 403,
        });
      intent.actorId = context().actorId;
      save();
      update({
        phase: intent.creationStarted ? "uncertain" : "form",
        formKey: intent.creationStarted ? "" : `${uuid()}:${version}`,
        orgKind: intent.orgKind,
        recipientEmail: invitation.recipientEmail,
        canRetry: Boolean(frozenPayload),
        message: intent.creationStarted
          ? "Creation is unconfirmed. Check its saved status before continuing."
          : "",
      });
    } catch (error) {
      if (snapshot !== key() || version !== generation) return;
      if (error?.status === 401)
        update({
          phase: "blocked",
          message:
            "Sign in with the invited, verified email, then return to this invitation.",
          requiresSignIn: true,
          canRetry: false,
        });
      else if ([403, 404].includes(error?.status)) {
        forget();
        clearDraft();
        update({
          phase: "blocked",
          message:
            "This invitation is unavailable. Sign in with the invited, verified email or ask for a new invitation.",
          canRetry: false,
        });
      } else
        update({
          phase: "blocked",
          message: "The invitation could not be checked. Try checking again.",
          canRetry: false,
        });
    }
  }
  async function create() {
    const snapshot = key(),
      version = ++generation;
    update({
      phase: "creating",
      message: "Creating your organization…",
      canRetry: false,
    });
    try {
      const response = await call(
        "/api/coalitions",
        JSON.parse(frozenPayload),
        30000,
        snapshot,
        version,
      );
      guard(snapshot, version);
      finish(response?.coalition?.coalitionId);
    } catch (error) {
      if (snapshot !== key() || version !== generation) return;
      if (error?.status === 401) {
        intent.creationStarted = false;
        save();
        frozenPayload = null;
        clearDraft();
        update({
          phase: "blocked",
          message:
            "Sign in with the invited account, then return to this invitation.",
          requiresSignIn: true,
        });
      } else if (error?.status === 403) {
        forget();
        clearDraft();
        update({
          phase: "blocked",
          message:
            "The invitation could not be used. Sign in with the invited account and reopen it.",
        });
      } else if ([400, 422].includes(error?.status)) {
        frozenPayload = null;
        intent.creationStarted = false;
        save();
        update({
          phase: "form",
          message: "Check the organization and legal details, then try again.",
        });
      } else
        update({
          phase: "uncertain",
          message:
            "Creation is unconfirmed. Check its saved status before continuing.",
          canRetry: false,
        });
    }
  }
  async function submit(form) {
    if (intent && !usable(intent)) {
      forget();
      reset();
      changed();
      return false;
    }
    if (
      view.phase !== "form" ||
      !intent ||
      intent.actorId !== context()?.actorId ||
      owner !== key()
    )
      return false;
    const body = organizationSignupPayload(form),
      error = validateOrganizationSignup(body);
    if (error) {
      update({ message: error });
      return false;
    }
    frozenPayload = JSON.stringify({
      ...body,
      invitationToken: intent.invitationToken,
      clientRequestId: intent.clientRequestId,
    });
    intent.creationStarted = true;
    try {
      save();
    } catch {
      frozenPayload = null;
      update({
        phase: "blocked",
        message:
          "This browser could not save the signup. Reopen the invitation before trying again.",
      });
      return false;
    }
    await create();
    return true;
  }
  async function action(name) {
    if (intent && !usable(intent)) {
      forget();
      reset();
      changed();
      return false;
    }
    if (name === "organization-signup-cancel") {
      if (view.phase !== "creating") {
        forget();
        reset();
        navigate("/coalitions");
      }
      return true;
    }
    if (name === "organization-signup-sign-in") {
      if (view.requiresSignIn)
        navigate("/auth?returnTo=%2Forganizations%2Fsignup");
      return true;
    }
    if (name === "organization-signup-check") {
      if (!["checking", "creating"].includes(view.phase))
        await load({ force: true });
      return true;
    }
    if (name === "organization-signup-retry") {
      if (
        view.phase === "uncertain" &&
        view.canRetry &&
        frozenPayload &&
        owner === key()
      )
        await create();
      return true;
    }
    return false;
  }
  function operationGuard() {
    const snapshot = key(),
      version = generation;
    if (!snapshot || owner !== snapshot || view.phase !== "form")
      throw new Error("organization_signup_context_changed");
    return () => {
      guard(snapshot, version);
      if (view.phase !== "form")
        throw new Error("organization_signup_context_changed");
    };
  }
  return {
    captureLocation,
    load,
    submit,
    action,
    reset,
    operationGuard,
    ownsForm: (formKey) =>
      Boolean(
        formKey &&
          formKey === view.formKey &&
          view.phase === "form" &&
          owner === key(),
      ),
    state: () => ({ ...view }),
  };
}

/** Existing website form styles and image uploader are shared with the invited flow. */
export function renderOrganizationSignup(
  view,
  { values = {}, imageField = "", states = [] } = {},
) {
  const value = (name, fallback = "") => text(values[name] ?? fallback);
  const kind = kindOf(value("orgKind", view.orgKind || "coalition"));
  const pac =
    kind === "pac" ||
    (!["state_party", "county_party"].includes(kind) &&
      value("pacAssociated") === "true");
  const classification =
    kind === "state_party"
      ? "state_party_committee"
      : kind === "county_party"
        ? "county_party_committee"
        : pac
          ? "other_political_committee"
          : value("committeeClassification", "non_political_organization");
  const field = (
    name,
    label,
    { required = true, type = "text", extra = "" } = {},
  ) =>
    `<label><span>${e(label)}</span><input name="${e(name)}" type="${e(type)}" value="${e(value(name))}"${required ? " required" : ""} ${extra}></label>`;
  const select = (name, label, choices, current) =>
    `<label><span>${e(label)}</span><select name="${e(name)}" required>${choices.map(([choice, title]) => `<option value="${e(choice)}"${selected(current, choice)}>${e(title)}</option>`).join("")}</select></label>`;
  const button = (action, label) =>
    `<button class="shared-feed-chip" type="button" data-action="${action}">${e(label)}</button>`;
  const back = `<button class="shared-feed-chip" type="button" data-action="organization-signup-cancel"${view.phase === "creating" ? " disabled" : ""}>Your organizations</button>`;
  const header = `<div class="shared-page__header"><div><h1>${["form", "creating"].includes(view.phase) ? "Organization signup" : view.phase === "checking" ? "Checking invitation" : view.phase === "uncertain" ? "Check organization status" : "Invitation required"}</h1>${view.recipientEmail && ["form", "creating"].includes(view.phase) ? `<p>Invited: ${e(view.recipientEmail)}</p>` : ""}</div>${back}</div>`;
  if (!["form", "creating"].includes(view.phase))
    return (
      header +
      `<section class="shared-coalition-panel"><p role="status">${e(view.message)}</p><div class="shared-card__actions">${view.requiresSignIn ? button("organization-signup-sign-in", "Sign in") : ["blocked", "uncertain"].includes(view.phase) ? button("organization-signup-check", "Check invitation") : ""}${view.canRetry ? button("organization-signup-retry", "Retry same details") : ""}</div></section>`
    );
  const party = ["state_party", "county_party"].includes(kind);
  const registration =
    classification === "non_political_organization"
      ? value("registrationStatus", "registered")
      : "registered";
  return (
    header +
    `<form class="shared-coalition-profile-form" data-route-form="coalition-start-create" data-organization-signup-form="${e(view.formKey || "")}"><fieldset class="shared-coalition-profile-form is-full"${view.phase === "creating" ? " disabled" : ""}>
    ${view.message ? `<p class="shared-page__error is-full" role="alert">${e(view.message)}</p>` : ""}
    ${select(
      "orgKind",
      "Organization type",
      [
        ["coalition", "Coalition"],
        ["pac", "PAC"],
        ["state_party", "State party"],
        ["county_party", "County party"],
        ["candidate_support", "Campaign support organization"],
      ],
      kind,
    )}
    ${
      kind === "coalition"
        ? select(
            "coalitionType",
            "Coalition type",
            [
              ["simple", "Simple"],
              ["constitutional", "Constitutional"],
            ],
            value("coalitionType", "simple"),
          )
        : ""
    }
    ${field("name", "Organization name")}<label class="is-full"><span>Description</span><textarea name="description" rows="3" required>${e(value("description"))}</textarea></label>
    ${imageField || field("imageUrl", "Organization image link", { type: "url" })}
    ${
      ["coalition", "candidate_support"].includes(kind)
        ? select(
            "pacAssociated",
            "PAC association",
            [
              ["false", "Not PAC-associated"],
              ["true", "PAC-associated"],
            ],
            value("pacAssociated", "false"),
          )
        : ""
    }${pac ? field("fecNumber", "FEC number") : ""}
    ${["state_party", "county_party", "candidate_support"].includes(kind) ? select("stateId", "Organization state", [["", "Choose state"], ...states], value("stateId")) : ""}
    ${kind === "county_party" ? field("countyName", "County name") : ""}${kind === "candidate_support" ? field("districtId", "District", { required: false }) + field("districtName", "District name", { required: false }) : ""}
    ${party ? field("partyLabel", "Party name") + field("partyAbbrev", "Party abbreviation") + field("committeeId", "Committee number", { required: false }) : ""}
    <h2 class="is-full">Legal organization</h2>${field("legalName", "Legal name")}${field("ein", "EIN", { type: "password", extra: 'autocomplete="off" inputmode="numeric"' })}
    ${
      !party && !pac
        ? select(
            "committeeClassification",
            "Classification",
            [
              ["non_political_organization", "Non-political organization"],
              ["candidate_committee", "Candidate committee"],
              ["other_political_committee", "Other political committee"],
            ],
            classification,
          )
        : ""
    }
    ${field("addressLine1", "Legal street address")}${field("addressLine2", "Address line 2", { required: false })}${field("city", "City")}${field("region", "State code", { extra: 'maxlength="2" pattern="[A-Za-z]{2}"' })}${field("postalCode", "ZIP code")}${field("websiteUrl", "Website", { type: "url" })}
    <h2 class="is-full">Authorized representative</h2>${field("representativeFirstName", "First name")}${field("representativeLastName", "Last name")}${field("representativeTitle", "Title")}${field("representativeEmail", "Representative email", { type: "email" })}${field("representativePhone", "Representative phone", { type: "tel", extra: 'placeholder="+14065550100"' })}
    <h2 class="is-full">Election registration</h2>${
      classification === "non_political_organization"
        ? select(
            "registrationStatus",
            "Registration",
            [
              ["registered", "Registered"],
              ["not_applicable", "Not applicable"],
            ],
            registration,
          )
        : ""
    }
    ${registration === "not_applicable" ? field("notApplicableReason", "Why registration does not apply", { extra: 'minlength="10"' }) : field("authorityName", "Registration authority") + field("registrationId", "Registration number") + field("filingUrl", "Official filing link", { type: "url" })}
    <details class="is-full"><summary>Social links (optional)</summary>${["facebook", "threads", "bluesky", "instagram", "tiktok"].map((name) => field(`social:${name}`, name[0].toUpperCase() + name.slice(1), { required: false, type: "url" })).join("")}</details>
    <div class="shared-card__actions is-full"><button class="shared-feed-chip shared-feed-chip--primary" type="submit">${view.phase === "creating" ? "Creating…" : "Create organization"}</button></div>
  </fieldset></form>`
  );
}
