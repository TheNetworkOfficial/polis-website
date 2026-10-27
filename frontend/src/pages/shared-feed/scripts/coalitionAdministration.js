import { icon } from "./coalitionAdministrationIcons.js";
import {
  adminText as text,
  adminEscape as esc,
  adminUrl,
  adminProfile,
  adminPermissions,
  adminProfileErrors,
  adminProfilePayload,
  adminScripts,
  adminScriptsPayload,
  adminRevision,
  adminUpload,
  adminEqual,
  adminChannels as channels,
  adminSocialLabels as socialLabels,
} from "./coalitionAdministrationModel.js";

/** The real Administration workspace. Drafts, requests and dialogs remain scoped
 * to their authenticated actor and organization across unrelated shell renders. */
export function createCoalitionAdministration({
  context,
  account,
  request,
  navigate,
  onProfile = () => {},
  onContextInvalidated = () => {},
} = {}) {
  let host, flight, focusSnapshot, toastTimer, confirmation, dialogOpener;
  let generation = 0,
    loadSequence = 0,
    authoritySequence = 0,
    mutationEpoch = 0;
  const current = () => context?.() || null;
  const identity = (c = current()) =>
    c?.userId && c?.coalitionId ? `${c.userId}|${c.coalitionId}` : "";
  const clone = (value) => structuredClone(value);
  const fresh = () => ({
    key: "",
    credential: "",
    path: "",
    tab: "profile",
    routeTab: "profile",
    channel: "phoneCall",
    condition: "loading",
    loaded: false,
    profile: adminProfile(),
    savedProfile: adminProfile(),
    scripts: adminScripts(),
    savedScripts: adminScripts(),
    member: null,
    coalition: {},
    revision: null,
    latest: null,
    scriptsLoaded: false,
    scriptsError: "",
    saving: "",
    uploading: false,
    uploadError: "",
    errors: {},
    message: "",
    lastSaved: "",
    details: { pac: false, social: false },
    uncertainties: { profile: null, outreach: null },
    conflicts: { profile: false, outreach: false },
    writeIntent: null,
    allowedNavigation: "",
    uploadController: null,
  });
  let state = fresh();
  const q = (selector) => host?.querySelector(selector);
  const rights = () =>
    adminPermissions(
      state.member,
      state.coalition?.coalitionId
        ? state.coalition
        : current()?.coalition || {},
    );
  const canProfile = () => rights().profile;
  const canScripts = () => rights().scripts;
  const canCurrent = () =>
    state.tab === "profile" ? canProfile() : canScripts();
  const profileDirty = () => !adminEqual(state.profile, state.savedProfile);
  const scriptsDirty = () => !adminEqual(state.scripts, state.savedScripts);
  const dirty = () => profileDirty() || scriptsDirty();
  const currentDirty = () =>
    state.tab === "profile" ? profileDirty() : scriptsDirty();
  const busy = () => Boolean(state.saving || state.uploading);
  const scriptReady = (script) =>
    Boolean(script.title.trim() && script.body.trim());
  const httpUrl = (value) => Boolean(adminUrl(value));
  const imageSource = (value) => adminUrl(value);
  const button = (label, action, primary = false, extra = "") =>
    `<button type="button" class="${primary ? "primary-button" : "secondary-button"}" data-admin-action="${action}" ${extra}>${label}</button>`;
  const fieldError = (name) =>
    state.errors[name]
      ? `<small class="form-error" id="error-${name}">${esc(state.errors[name])}</small>`
      : "";
  const endpoint = () =>
    `/api/coalitions/${encodeURIComponent(current().coalitionId)}`;
  const scriptsEndpoint = () => `${endpoint()}/voter-map/outreach-templates`;

  function inputField(
    name,
    label,
    { required = false, type = "text", wide = false, placeholder = "" } = {},
  ) {
    return `<label class="field${wide ? " wide" : ""}"><span>${label}${required ? ' <span aria-hidden="true">*</span>' : ""}</span><input name="${name}" type="${type}" value="${esc(state.profile[name])}" ${required ? 'required aria-required="true"' : ""} ${placeholder ? `placeholder="${esc(placeholder)}"` : ""} ${!canProfile() || busy() || state.uncertainties.profile ? "disabled" : ""} ${state.errors[name] ? `aria-invalid="true" aria-describedby="error-${name}"` : ""} />${fieldError(name)}</label>`;
  }
  function panel(title, subtitle, body, extra = "") {
    return `<section class="panel ${extra}"><div class="panel-header"><div><h2>${title}</h2><p>${subtitle}</p></div></div><div class="panel-body">${body}</div></section>`;
  }

  function renderProfile() {
    const pac = state.profile.pacAssociated;
    const disabled =
      !canProfile() || busy() || Boolean(state.uncertainties.profile);
    const logo = `<div class="logo-editor"><div class="logo-preview">${state.profile.imageUrl ? `<img src="${esc(imageSource(state.profile.imageUrl))}" alt="Organization image" />` : `<span class="logo-placeholder" aria-label="No organization image">${icon("upload")}</span>`}</div><div class="logo-actions"><strong>Organization image</strong><div class="inline-actions">${button(icon("upload") + " Change image", "choose-image", false, disabled ? "disabled" : "")}${button("Use image URL", "image-url", false, disabled ? "disabled" : "")}</div><p class="field-hint">JPG, PNG or WebP · up to 8 MB</p></div><input type="file" id="organization-image" accept="image/jpeg,image/png,image/webp" hidden ${disabled ? "disabled" : ""} /></div>${state.uploadError ? `<p class="form-error" role="alert">${esc(state.uploadError)}</p>` : ""}${fieldError("imageUrl")}`;
    const organization =
      logo +
      `<div class="form-grid">${inputField("name", "Organization name", { required: true })}<label class="field"><span>Organization type</span><select name="coalitionType" ${disabled ? "disabled" : ""}><option value="simple" ${state.profile.coalitionType === "simple" ? "selected" : ""}>Simple</option><option value="constitutional" ${state.profile.coalitionType === "constitutional" ? "selected" : ""}>Constitutional</option></select></label><label class="field wide"><span>Description <span aria-hidden="true">*</span></span><textarea name="description" rows="3" required aria-required="true" ${disabled ? "disabled" : ""} ${state.errors.description ? 'aria-invalid="true"' : ""}>${esc(state.profile.description)}</textarea>${fieldError("description")}</label><details class="pac-details wide" ${state.errors.fecNumber ? "open" : ""}><summary>PAC details${pac ? '<span class="status-pill">Associated</span>' : ""}</summary><div class="details-body"><label class="toggle-row"><input type="checkbox" name="pacAssociated" ${pac ? "checked" : ""} ${disabled ? "disabled" : ""} /><span>This organization is PAC associated</span></label><div data-pac-field ${pac ? "" : "hidden"}>${inputField("fecNumber", "FEC number", { required: pac, wide: true })}</div><p class="field-hint">Record your organization’s existing PAC details.</p></div></details></div>`;
    const contact = `<div class="form-grid">${inputField("primaryContactName", "Primary contact", { required: true, wide: true })}${inputField("email", "Email", { required: true, type: "email" })}${inputField("phone", "Phone", { required: true, type: "tel" })}${inputField("website", "Website", { type: "url", wide: true, placeholder: "https://" })}<details class="social-details wide" ${Object.keys(state.errors).some((key) => key in socialLabels) ? "open" : ""}><summary>Social links<span>${Object.values(socialLabels).length} platforms</span></summary><div class="details-body form-grid">${Object.entries(
      socialLabels,
    )
      .map(([name, label]) =>
        inputField(name, label, {
          type: "url",
          wide: true,
          placeholder: "https://",
        }),
      )
      .join("")}</div></details></div>`;
    return `${!canProfile() ? '<div class="read-only-banner">' + icon("lock") + "<span>You can view organization details. An administrator or profile editor can make changes.</span></div>" : ""}${state.condition === "empty" ? '<p class="form-hint">Start with your organization’s name, image and contact details.</p>' : ""}${renderNotice()}<form id="profile-form" class="admin-profile-grid" novalidate>${panel("Organization", "How your organization appears across Polis.", organization)}${panel("Contact & links", "How people can reach your organization.", contact)}</form>`;
  }
  function interpolate(value) {
    return String(value)
      .replace(/\{\{firstName\}\}/g, "Casey")
      .replace(/\{\{volunteerName\}\}/g, "Jordan")
      .replace(
        /\{\{campaignName\}\}/g,
        state.savedProfile.name || state.coalition?.name || "Your organization",
      );
  }
  function scriptPreviewMarkup() {
    const channel = channels.find((item) => item.key === state.channel);
    const draft = state.scripts[state.channel];
    return `<div class="preview-recipient"><span class="eyebrow">${channel.channel}</span><small>Example recipient · Casey</small></div><h3>${esc(interpolate(draft.title) || "Your template title")}</h3><p class="preview-copy">${esc(interpolate(draft.body) || "Your message preview will appear here.")}</p>`;
  }
  function renderOutreach() {
    const draft = state.scripts[state.channel];
    const channel = channels.find((item) => item.key === state.channel);
    const disabled =
      !canScripts() || busy() || Boolean(state.uncertainties.outreach);
    const channelList = `<section class="panel script-channels"><div class="panel-header"><div><h2>Channels</h2><p>Shared with field teams.</p></div></div><div class="panel-body channel-list">${channels.map((item) => `<button type="button" class="channel-button${item.key === state.channel ? " active" : ""}" data-admin-action="channel" data-channel="${item.key}" aria-pressed="${item.key === state.channel}">${icon(item.icon)}<span><strong>${item.label}</strong><small data-channel-status="${item.key}">${scriptReady(state.scripts[item.key]) ? "Ready" : "Draft"}</small></span>${item.key === state.channel ? icon("arrow") : ""}</button>`).join("")}</div></section>`;
    const editor = `<div class="script-editor-layout">${panel(channel.label + " template", "Reusable copy for outreach from the voter map.", `<form id="script-form" novalidate><div class="form-grid"><label class="field wide"><span>Template title</span><input name="scriptTitle" maxlength="120" value="${esc(draft.title)}" placeholder="Give this template a title" ${disabled ? "disabled" : ""} /><small class="field-hint" data-title-count>${draft.title.length} / 120</small></label><label class="field wide"><span>${channel.key === "mailEmail" ? "Email body" : "Template body"}</span><textarea name="scriptBody" maxlength="5000" rows="10" placeholder="Write your team’s shared message…" ${disabled ? "disabled" : ""}>${esc(draft.body)}</textarea><small class="field-hint" data-body-count>${draft.body.length} / 5,000</small></label><div class="wide merge-fields"><span>Insert merge field</span>${channel.tokens.map((token) => `<button type="button" class="text-button" data-admin-action="insert-token" data-token="${token}" ${disabled ? "disabled" : ""}>{{${token}}}</button>`).join("")}</div></div></form>`)}${panel("Preview", "Example values show how the template reads.", `<div class="script-preview" data-script-preview>${scriptPreviewMarkup()}</div>`, "script-preview-panel")}</div>`;
    return `${!canScripts() ? '<div class="read-only-banner">' + icon("lock") + "<span>Only organization administrators can save outreach templates.</span></div>" : ""}${renderNotice()}<div class="outreach-actions"><p class="form-hint">Saving templates updates shared copy. It doesn’t send messages.</p>${button(icon("refresh") + " Reload saved templates", "refresh-scripts", false, busy() ? "disabled" : "")}</div><div class="outreach-layout">${channelList}<div class="script-workspace">${editor}</div></div>`;
  }

  function previewProfile() {
    const p = state.profile;
    openDialog(
      "Profile preview",
      `<div class="public-profile-preview"><div class="profile-preview-image"><img src="${esc(imageSource(p.imageUrl))}" alt="Organization image" /></div><span class="eyebrow">${p.coalitionType === "constitutional" ? "Constitutional" : "Simple"} organization</span><h3>${esc(p.name || "Organization name")}</h3><p>${esc(p.description || "Your description will appear here.")}</p><dl class="profile-contact-preview"><div><dt>Primary contact</dt><dd>${esc(p.primaryContactName || "Not added")}</dd></div><div><dt>Email</dt><dd>${esc(p.email || "Not added")}</dd></div><div><dt>Phone</dt><dd>${esc(p.phone || "Not added")}</dd></div>${p.website ? `<div><dt>Website</dt><dd>${esc(p.website)}</dd></div>` : ""}</dl>${
        Object.entries(socialLabels).some(([key]) => p[key])
          ? `<div class="preview-socials">${Object.entries(socialLabels)
              .filter(([key]) => p[key])
              .map(([, label]) => `<span>${label}</span>`)
              .join("")}</div>`
          : ""
      }<p class="field-hint">Showing your current profile draft.</p></div>`,
    );
  }

  function showImageUrl() {
    if (!canProfile() || busy() || state.uncertainties.profile) return;
    const current = httpUrl(state.profile.imageUrl)
      ? state.profile.imageUrl
      : "";
    openDialog(
      "Use a hosted image",
      `<form id="image-url-form"><label class="field"><span>Image URL</span><input name="hostedImageUrl" type="url" required value="${esc(current)}" placeholder="https://example.com/logo.png" autocomplete="url" /><small class="field-hint">Use a hosted image that your organization can access.</small></label><p class="form-error" id="image-url-error" role="alert" hidden></p></form>`,
      button("Cancel", "close-dialog") +
        button("Use image URL", "apply-image-url", true),
    );
  }
  function applyImageUrl() {
    if (!canProfile() || busy() || state.uncertainties.profile) return;
    const input = q('[name="hostedImageUrl"]');
    if (!input) return;
    const value = input.value.trim();
    if (!httpUrl(value)) {
      q("#image-url-error").hidden = false;
      q("#image-url-error").textContent =
        "Use a complete http:// or https:// image address.";
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    state.profile.imageUrl = value;
    state.uploadError = "";
    delete state.errors.imageUrl;
    closeDialog();
    render();
    toast("Image URL updated. Save the profile to apply it.");
  }

  function insertToken(token) {
    if (!canScripts() || busy()) return;
    const config = channels.find((item) => item.key === state.channel);
    if (!config.tokens.includes(token)) return;
    const field = q('[name="scriptBody"]');
    const value = `{{${token}}}`;
    if (
      field.value.length -
        (field.selectionEnd - field.selectionStart) +
        value.length >
      5000
    ) {
      toast("The template body is limited to 5,000 characters.");
      return;
    }
    field.setRangeText(value, field.selectionStart, field.selectionEnd, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  }
  function updateScriptPreview() {
    if (q("[data-script-preview]"))
      q("[data-script-preview]").innerHTML = scriptPreviewMarkup();
    const draft = state.scripts[state.channel];
    if (q("[data-title-count]"))
      q("[data-title-count]").textContent = `${draft.title.length} / 120`;
    if (q("[data-body-count]"))
      q("[data-body-count]").textContent = `${draft.body.length} / 5,000`;
    const status = q(`[data-channel-status="${state.channel}"]`);
    if (status) status.textContent = scriptReady(draft) ? "Ready" : "Draft";
  }

  function reset() {
    generation++;
    loadSequence++;
    flight = null;
    state.uploadController?.abort();
    clearTimeout(toastTimer);
    confirmation = null;
    focusSnapshot = null;
    host?.remove();
    host = null;
    state = fresh();
  }
  function sync() {
    const c = current();
    if (!c?.sessionKey || !identity(c)) {
      if (state.key) reset();
      return false;
    }
    if (
      identity(c) !== state.key ||
      (state.credential && state.credential !== c.sessionKey)
    ) {
      reset();
      state.key = identity(c);
      state.credential = c.sessionKey;
      state.tab = c.tab === "outreach" ? "outreach" : "profile";
      state.routeTab = state.tab;
    }
    state.path = c.path;
    if (c.tab && c.tab !== state.routeTab) {
      state.tab = c.tab;
      state.routeTab = c.tab;
    }
    return true;
  }
  function guard(
    ticket,
    capability = "",
    { renew = false, path = state.path } = {},
  ) {
    const c = current();
    if (
      ticket !== generation ||
      !state.key ||
      identity(c) !== state.key ||
      !c?.sessionKey ||
      c.path !== path
    )
      throw Object.assign(
        new Error("Your account or workspace changed. Reopen Administration."),
        { stale: true },
      );
    if (c.sessionKey !== state.credential) {
      if (renew) state.credential = c.sessionKey;
      else {
        reset();
        onContextInvalidated();
        throw Object.assign(
          new Error("Your sign-in changed. Reopen Administration."),
          { stale: true },
        );
      }
    }
    if (capability && !rights()[capability])
      throw Object.assign(
        new Error("Your current access does not allow this change."),
        { status: 403 },
      );
  }
  async function call(path, options = {}, capability = "") {
    const ticket = generation,
      pagePath = state.path,
      readEpoch = mutationEpoch;
    guard(ticket, capability);
    const headers = Object.fromEntries(
      Object.entries(options.headers || {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    headers["x-polis-expected-actor"] = current().userId;
    let dispatchedCredential = "";
    const response = await request(path, {
      ...options,
      headers,
      auth: true,
      beforeRequest: () => {
        guard(ticket, capability, { renew: true, path: pagePath });
        options.beforeRequest?.();
      },
      beforeDispatch: () => {
        guard(ticket, capability, { renew: true, path: pagePath });
        dispatchedCredential = current().sessionKey;
        options.beforeDispatch?.();
      },
    }).catch((error) => {
      if (
        Number(error.status) === 401 &&
        ticket === generation &&
        identity() === state.key
      ) {
        if (
          dispatchedCredential &&
          dispatchedCredential !== current()?.sessionKey
        )
          throw Object.assign(error, { stale: true });
        clearPrivateAccess();
      }
      throw error;
    });
    guard(ticket, capability, { path: pagePath });
    if (
      (!options.method || options.method === "GET") &&
      readEpoch !== mutationEpoch
    )
      throw Object.assign(
        new Error("A newer organization update superseded this read."),
        { stale: true },
      );
    if (response?.ok === false)
      throw Object.assign(
        new Error(
          text(response.error || response.message) ||
            "The request could not be completed.",
        ),
        { payload: response },
      );
    return response;
  }
  function record(payload) {
    const coalition = payload?.coalition;
    if (
      !coalition ||
      text(coalition.coalitionId || coalition.id) !== current()?.coalitionId
    )
      throw new Error("The organization response could not be confirmed.");
    return {
      payload,
      coalition: {
        ...current()?.coalition?.raw,
        ...current()?.coalition,
        ...coalition,
      },
      member: payload.membership || null,
      profile: adminProfile(payload),
      revision: adminRevision(payload),
    };
  }
  function acceptAuthority(value) {
    state.member = value.member;
    state.coalition = value.coalition;
    if (!rights().active || (!rights().view && !rights().scriptsView)) {
      state.profile = adminProfile();
      state.savedProfile = adminProfile();
      state.scripts = adminScripts();
      state.savedScripts = adminScripts();
      state.loaded = false;
      state.scriptsLoaded = false;
      state.condition = "denied";
      state.uncertainties = { profile: null, outreach: null };
      closeDialog({ force: true });
    } else {
      if (state.condition === "denied") state.condition = "ready";
      if (!rights().view) {
        state.profile = adminProfile();
        state.savedProfile = adminProfile();
        state.revision = null;
        state.errors = {};
        state.uncertainties.profile = null;
        state.conflicts.profile = false;
      }
    }
    onProfile(value.payload, current().coalitionId);
  }
  function clearPrivateAccess() {
    mutationEpoch++;
    state.member = { role: "member", status: "inactive", permissions: [] };
    state.profile = adminProfile();
    state.savedProfile = adminProfile();
    state.scripts = adminScripts();
    state.savedScripts = adminScripts();
    state.uncertainties = { profile: null, outreach: null };
    state.conflicts = { profile: false, outreach: false };
    state.condition = "denied";
    state.loaded = false;
    state.scriptsLoaded = false;
    state.uploadController?.abort();
    state.uploading = false;
    closeDialog({ force: true });
  }
  async function freshRead() {
    const ticket = generation,
      sequence = ++authoritySequence;
    const value = record(await call(endpoint()));
    guard(ticket);
    if (sequence !== authoritySequence)
      throw Object.assign(
        new Error("A newer organization access check superseded this read."),
        { stale: true },
      );
    value.authoritySequence = sequence;
    acceptAuthority(value);
    return value;
  }
  function guardAuthority(value, ticket, capability) {
    guard(ticket, capability);
    if (value.authoritySequence !== authoritySequence)
      throw Object.assign(
        new Error(
          "Organization access is being checked again. Retry this change.",
        ),
        { stale: true },
      );
  }
  async function load({ refresh = false } = {}) {
    if (!sync()) return;
    if (flight && !refresh) return flight;
    if (state.loaded && !refresh) {
      render();
      if (state.tab === "outreach" && !state.scriptsLoaded) await readScripts();
      return;
    }
    const ticket = generation,
      sequence = ++loadSequence;
    if (!state.loaded) state.condition = "loading";
    render();
    const task = (async () => {
      try {
        const value = await freshRead();
        guard(ticket);
        if (sequence !== loadSequence || state.condition === "denied") return;
        const changed =
          rights().view &&
          state.loaded &&
          (!adminEqual(state.savedProfile, value.profile) ||
            state.revision !== value.revision);
        if (rights().view && (!state.loaded || !profileDirty())) {
          state.profile = clone(value.profile);
          state.savedProfile = clone(value.profile);
          state.revision = value.revision;
        } else if (changed) {
          state.conflicts.profile = true;
          state.latest = value;
        }
        state.loaded = true;
        state.condition = "ready";
        if (
          state.tab === "outreach" &&
          rights().scriptsView &&
          (!state.scriptsLoaded || refresh)
        )
          await readScripts({ preserve: true });
      } catch (error) {
        if (error.stale || ticket !== generation) return;
        state.message =
          error.message || "Organization settings could not be loaded.";
        state.condition = [401, 403].includes(Number(error.status))
          ? "denied"
          : "error";
        if (state.condition === "denied") clearPrivateAccess();
      } finally {
        if (ticket === generation && sequence === loadSequence) render();
      }
    })();
    flight = task;
    await task;
    if (flight === task) flight = null;
  }
  async function readScripts({ preserve = true } = {}) {
    if (!rights().scriptsView) {
      state.scriptsError =
        "Your current access does not include outreach templates.";
      render();
      return;
    }
    if (state.scriptsLoading) return;
    const ticket = generation;
    state.scriptsLoading = true;
    state.scriptsError = "";
    render();
    try {
      const payload = await call(scriptsEndpoint(), {}, "scriptsView");
      const next = adminScripts(payload);
      if (!preserve || !state.scriptsLoaded || !scriptsDirty()) {
        state.scripts = clone(next);
        state.savedScripts = clone(next);
      } else if (!adminEqual(next, state.savedScripts))
        state.conflicts.outreach = true;
      state.scriptsLoaded = true;
    } catch (error) {
      if (!error.stale && ticket === generation)
        state.scriptsError = error.message || "Templates could not be loaded.";
    } finally {
      if (ticket === generation) {
        state.scriptsLoading = false;
        render();
      }
    }
  }
  function currentUncertain() {
    return Boolean(state.uncertainties[state.tab]);
  }
  const anyUncertain = () => Object.values(state.uncertainties).some(Boolean);
  function updateSaveStatus() {
    const save = q("#save-button");
    if (!save) return;
    save.textContent = state.saving
      ? "Saving…"
      : state.tab === "profile"
        ? "Save profile"
        : "Save templates";
    save.hidden = !canCurrent();
    save.disabled =
      !currentDirty() ||
      busy() ||
      state.condition === "loading" ||
      (state.tab === "outreach" && !state.scriptsLoaded) ||
      currentUncertain();
    q("#save-state").textContent = state.uploading
      ? "Uploading image…"
      : state.saving
        ? "Saving changes…"
        : currentUncertain()
          ? "Save needs checking"
          : currentDirty()
            ? "Unsaved changes"
            : state.lastSaved || "All changes saved";
    q("#save-state").dataset.dirty = String(currentDirty());
    const preview = q("#preview-profile-button");
    preview.hidden = !rights().view || state.tab !== "profile";
    preview.disabled = busy() || !state.loaded;
    for (const tab of host.querySelectorAll("#view-tabs [data-tab]")) {
      const changed =
        tab.dataset.tab === "profile" ? profileDirty() : scriptsDirty();
      const dot = tab.querySelector(".unsaved-dot");
      if (changed && !dot)
        tab.insertAdjacentHTML(
          "beforeend",
          '<span class="unsaved-dot" aria-label="Unsaved changes">•</span>',
        );
      if (!changed && dot) dot.remove();
      tab.disabled = busy() || state.condition === "loading";
    }
  }
  function renderNotice() {
    if (currentUncertain())
      return `<div class="form-message warning" role="alert"><div><strong>The save could not be confirmed</strong><p>Your draft is kept. Check the saved details before making another change.</p></div>${button("Check saved details", "check-save")}${button("Reload saved details", "reload-current")}</div>`;
    if (state.conflicts[state.tab])
      return `<div class="form-message warning" role="alert"><div><strong>This organization was updated elsewhere</strong><p>Your draft is kept. Reload the saved details before making another change.</p></div>${button("Reload saved details", "reload-current")}</div>`;
    return state.message
      ? `<div class="form-message error" role="alert">${esc(state.message)}</div>`
      : "";
  }
  function render({ keepDetails = true } = {}) {
    if (!host) return;
    if (keepDetails) {
      if (q(".pac-details")) state.details.pac = q(".pac-details").open;
      if (q(".social-details"))
        state.details.social = q(".social-details").open;
    }
    const focused = host.contains(document.activeElement)
      ? document.activeElement
      : null;
    const snapshot = focused
      ? {
          id: focused.id,
          name: focused.name,
          action: focused.dataset.adminAction,
          tab: focused.dataset.tab,
          channel: focused.dataset.channel,
          start: focused.selectionStart,
          end: focused.selectionEnd,
        }
      : null;
    host.dataset.adminCondition = state.condition;
    host.dataset.adminOperation =
      state.saving || (state.uploading ? "upload" : "");
    if (!q("#view-content"))
      host.innerHTML = `<div class="admin-toolbar"><div data-admin-mobile-nav></div><header class="page-heading"><div><h1 id="main-title">Administration</h1><p class="page-subtitle" id="page-subtitle">Your organization’s identity and shared outreach templates.</p></div><div class="heading-actions"><span class="role-pill" id="role-label"></span><button type="button" class="secondary-button" id="preview-profile-button" data-admin-action="preview-profile">Preview profile</button><button type="button" class="primary-button" id="save-button" data-admin-action="save">Save profile</button></div></header><div class="admin-tab-row"><nav class="view-tabs" id="view-tabs" role="tablist" aria-label="Administration sections"></nav><span class="save-status" id="save-state" role="status"></span></div></div><div id="view-content" role="tabpanel"></div><dialog class="create-dialog" id="detail-dialog" aria-labelledby="dialog-title"></dialog><div class="toast" role="status" id="toast" hidden></div>`;
    const mobile = q("[data-admin-mobile-nav]");
    const mobileOpen = mobile.querySelector("details")?.open;
    mobile.innerHTML = current()?.mobileNavigation || "";
    if (mobileOpen && mobile.querySelector("details"))
      mobile.querySelector("details").open = true;
    q("#role-label").textContent = rights().admin
      ? "Admin"
      : canProfile()
        ? "Profile editor"
        : rights().view
          ? text(state.member?.roleLabel) || "Staff lead"
          : "Member";
    q("#view-tabs").innerHTML = [
      ["profile", "Profile", profileDirty()],
      ["outreach", "Outreach templates", scriptsDirty()],
    ]
      .map(
        ([key, label, changed]) =>
          `<button type="button" role="tab" id="admin-tab-${key}" aria-selected="${state.tab === key}" aria-controls="view-content" tabindex="${state.tab === key ? 0 : -1}" data-admin-action="tab" data-tab="${key}">${label}${changed ? '<span class="unsaved-dot" aria-label="Unsaved changes">•</span>' : ""}</button>`,
      )
      .join("");
    q("#view-content").setAttribute(
      "aria-labelledby",
      `admin-tab-${state.tab}`,
    );
    const restricted = `<div class="state-panel">${icon("lock")}<h2>Administration access required</h2><p>Your account can use the rest of this workspace. Ask an administrator if you need to manage the organization.</p><div class="state-actions">${button("Open People", "handoff-people")}</div></div>`;
    if (state.condition === "loading")
      q("#view-content").innerHTML =
        `<div class="state-panel" role="status"><span class="loading-ring"></span><h2>Loading organization settings</h2><p>Bringing your details together.</p></div>`;
    else if (
      state.condition === "denied" ||
      (state.tab === "profile" && !rights().view)
    )
      q("#view-content").innerHTML = restricted;
    else if (state.condition === "error" && !state.loaded)
      q("#view-content").innerHTML =
        `<div class="state-panel"><h2>Administration unavailable</h2><p>${esc(state.message || "Organization settings could not be loaded.")}</p><div class="state-actions">${button("Try again", "retry")}</div></div>`;
    else if (state.tab === "outreach" && !rights().scriptsView)
      q("#view-content").innerHTML =
        `<div class="state-panel">${icon("lock")}<h2>Outreach access required</h2><p>Your current field access does not include these templates.</p></div>`;
    else if (state.tab === "outreach" && !state.scriptsLoaded)
      q("#view-content").innerHTML =
        `<div class="state-panel"><h2>${state.scriptsLoading ? "Loading outreach templates" : "Templates unavailable"}</h2><p>${esc(state.scriptsError || "Bringing shared copy together.")}</p>${state.scriptsLoading ? "" : button("Try again", "refresh-scripts")}</div>`;
    else
      q("#view-content").innerHTML =
        state.tab === "profile"
          ? renderProfile()
          : `${state.scriptsError ? `<div class="form-message" role="alert">${esc(state.scriptsError)}</div>` : ""}${renderOutreach()}`;
    if (q(".pac-details"))
      q(".pac-details").open =
        state.details.pac || Boolean(state.errors.fecNumber);
    if (q(".social-details"))
      q(".social-details").open =
        state.details.social ||
        Object.keys(state.errors).some((key) => key in socialLabels);
    updateSaveStatus();
    if (snapshot) {
      const field = Array.from(
        host.querySelectorAll("button, input, textarea, select, a, summary"),
      ).find((candidate) => {
        if (snapshot.id) return candidate.id === snapshot.id;
        if (snapshot.name) return candidate.name === snapshot.name;
        return (
          snapshot.action &&
          candidate.dataset.adminAction === snapshot.action &&
          candidate.dataset.tab === snapshot.tab &&
          candidate.dataset.channel === snapshot.channel
        );
      });
      if (field && !field.disabled) field.focus({ preventScroll: true });
      try {
        if (typeof snapshot.start === "number")
          field?.setSelectionRange(snapshot.start, snapshot.end);
      } catch {
        /* Selects and email inputs do not expose a caret. */
      }
    }
  }
  function validateProfile() {
    state.errors = adminProfileErrors(state.profile);
    if (!Object.keys(state.errors).length) return true;
    render();
    const first = Object.keys(state.errors)[0];
    const target = q(
      first === "imageUrl"
        ? '[data-admin-action="choose-image"]'
        : `[name="${first}"]`,
    );
    target?.closest("details")?.setAttribute("open", "");
    target?.focus();
    target?.scrollIntoView({ block: "center" });
    return false;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    const node = q("#toast");
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    toastTimer = setTimeout(() => {
      if (node.isConnected) node.hidden = true;
    }, 4000);
  }
  function openDialog(title, body, footer = button("Done", "close-dialog")) {
    const dialog = q("#detail-dialog");
    if (!dialog) return;
    if (!dialog.open) dialogOpener = document.activeElement;
    dialog.innerHTML = `<header class="dialog-header"><div><h2 id="dialog-title">${esc(title)}</h2></div><button type="button" class="icon-button" data-admin-action="close-dialog" aria-label="Close dialog">${icon("close")}</button></header><div class="dialog-body">${body}</div><footer class="dialog-footer">${footer}</footer>`;
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog({ cancel = true, force = false } = {}) {
    if (busy() && !force) return;
    const previous = confirmation;
    confirmation = null;
    q("#detail-dialog")?.close();
    if (cancel) previous?.cancel?.();
    if (dialogOpener?.isConnected) dialogOpener.focus({ preventScroll: true });
  }
  function confirmAction(title, body, label, accept, cancel) {
    confirmation = { accept, cancel };
    openDialog(
      title,
      `<p>${esc(body)}</p>`,
      button("Keep editing", "close-dialog") +
        button(label, "confirm-action", true),
    );
  }
  async function authorize(capability) {
    const ticket = generation;
    const next = await freshRead();
    guard(ticket, capability);
    return next;
  }
  async function saveCurrent() {
    if (
      !sync() ||
      !canCurrent() ||
      busy() ||
      !currentDirty() ||
      currentUncertain()
    )
      return;
    const kind = state.tab,
      ticket = generation;
    if (kind === "profile" && !validateProfile()) return;
    state.saving = kind;
    state.message = "";
    render();
    let dispatched = false,
      submitted;
    try {
      const freshValue = await authorize(
        kind === "profile" ? "profile" : "scripts",
      );
      guard(ticket, kind === "profile" ? "profile" : "scripts");
      if (
        kind === "profile" &&
        (freshValue.revision !== state.revision ||
          !adminEqual(freshValue.profile, state.savedProfile))
      ) {
        state.conflicts[kind] = true;
        state.latest = freshValue;
        return;
      }
      if (kind === "profile") {
        submitted = adminProfilePayload(state.profile);
        state.writeIntent = { kind, submitted, dispatched: false };
        const body = {
          ...submitted,
          ...(state.revision !== null
            ? { expectedRevision: state.revision }
            : {}),
          clientRequestId: crypto.randomUUID(),
        };
        const payload = await call(
          endpoint(),
          {
            method: "PATCH",
            body,
            beforeDispatch: () => {
              guardAuthority(freshValue, ticket, "profile");
              mutationEpoch++;
              dispatched = true;
              state.writeIntent.dispatched = true;
            },
          },
          "profile",
        );
        guard(ticket, "profile");
        if (!payload?.coalition)
          throw new Error("The saved profile response was incomplete.");
        const value = record({
          ...payload,
          membership: payload.membership || state.member,
        });
        mutationEpoch++;
        acceptAuthority(value);
        state.profile = clone(value.profile);
        state.savedProfile = clone(value.profile);
        state.revision = value.revision;
        state.lastSaved = "Saved just now";
      } else {
        const saved = adminScripts(
          await call(scriptsEndpoint(), {}, "scriptsView"),
        );
        if (!adminEqual(saved, state.savedScripts)) {
          state.conflicts[kind] = true;
          return;
        }
        submitted = adminScriptsPayload(state.scripts);
        state.writeIntent = { kind, submitted, dispatched: false };
        const payload = await call(
          scriptsEndpoint(),
          {
            method: "PUT",
            body: submitted,
            beforeDispatch: () => {
              guardAuthority(freshValue, ticket, "scripts");
              mutationEpoch++;
              dispatched = true;
              state.writeIntent.dispatched = true;
            },
          },
          "scripts",
        );
        guard(ticket, "scripts");
        if (!payload?.templates)
          throw new Error("The saved template response was incomplete.");
        mutationEpoch++;
        state.scripts = adminScripts(payload);
        state.savedScripts = clone(state.scripts);
        state.scriptsLoaded = true;
        state.lastSaved = "Saved just now";
      }
      state.conflicts[kind] = false;
      state.uncertainties[kind] = null;
      state.errors = {};
      state.message = "";
      toast(
        kind === "profile"
          ? "Organization profile saved"
          : "Outreach templates saved",
      );
    } catch (error) {
      if (error.stale || ticket !== generation) return;
      const status = Number(error.status || 0),
        code = text(error.payload?.error || error.message);
      if (
        status === 409 &&
        [
          "organization_revision_conflict",
          "outreach_templates_changed",
        ].includes(code)
      )
        state.conflicts[kind] = true;
      else if (status === 409 && code === "name_taken")
        state.errors.name =
          "An organization already uses this name. Choose another name.";
      else if (dispatched && (!status || status >= 500))
        state.uncertainties[kind] = { kind, submitted };
      state.message = state.uncertainties[kind]
        ? ""
        : state.errors.name ||
          error.message ||
          "Changes could not be saved. Your draft is kept.";
    } finally {
      if (ticket === generation) {
        state.writeIntent = null;
        state.saving = "";
        render();
        if (state.errors.name) q('[name="name"]')?.focus();
      }
    }
  }
  async function checkSaved() {
    if (!currentUncertain() || busy()) return;
    const pending = state.uncertainties[state.tab],
      ticket = generation;
    state.saving = "check";
    render();
    try {
      const value = await authorize(
        pending.kind === "profile" ? "view" : "scriptsView",
      );
      guard(ticket);
      const saved =
        pending.kind === "profile"
          ? value.profile
          : adminScripts(await call(scriptsEndpoint(), {}, "scriptsView"));
      const expected =
        pending.kind === "profile"
          ? adminProfile({
              ...pending.submitted,
              socials: pending.submitted.socials,
            })
          : adminScripts(pending.submitted);
      guardAuthority(
        value,
        ticket,
        pending.kind === "profile" ? "view" : "scriptsView",
      );
      if (adminEqual(saved, expected)) {
        mutationEpoch++;
        if (pending.kind === "profile") {
          state.savedProfile = clone(saved);
          state.profile = clone(saved);
          state.revision = value.revision;
        } else {
          state.savedScripts = clone(saved);
          state.scripts = clone(saved);
        }
        state.uncertainties[pending.kind] = null;
        state.lastSaved = "Saved details checked";
        state.message =
          "The saved details match your changes. Review them before making another change.";
      } else
        state.message =
          "The interrupted save could not be confirmed. Your draft is kept; check again before making another change.";
    } catch (error) {
      if (!error.stale && ticket === generation)
        state.message =
          error.message ||
          "Saved details could not be checked. Your draft is kept.";
    } finally {
      if (ticket === generation) {
        state.saving = "";
        render();
      }
    }
  }
  function reloadCurrent(kind = state.tab) {
    if (busy()) return;
    const reload = async () => {
      const ticket = generation;
      state.saving = "reload";
      render();
      try {
        const value = await authorize(
          kind === "profile" ? "view" : "scriptsView",
        );
        if (kind === "profile") {
          state.profile = clone(value.profile);
          state.savedProfile = clone(value.profile);
          state.revision = value.revision;
        } else {
          const saved = adminScripts(
            await call(scriptsEndpoint(), {}, "scriptsView"),
          );
          guardAuthority(value, ticket, "scriptsView");
          state.scripts = clone(saved);
          state.savedScripts = clone(saved);
          state.scriptsLoaded = true;
        }
        state.conflicts[kind] = false;
        state.uncertainties[kind] = null;
        state.message = "";
        state.errors = {};
      } catch (error) {
        if (!error.stale && ticket === generation)
          state.message =
            error.message ||
            "Saved details could not be loaded. Your draft is kept.";
      } finally {
        if (ticket === generation) {
          state.saving = "";
          render();
        }
      }
    };
    if (
      (kind === "profile" ? profileDirty() : scriptsDirty()) ||
      state.uncertainties[kind]
    )
      confirmAction(
        kind === "profile"
          ? "Reload saved profile?"
          : "Reload saved templates?",
        "Unsaved changes in this section will be discarded. Changes in the other section will be kept.",
        "Reload saved",
        () => {
          void reload();
        },
      );
    else void reload();
  }
  async function chooseImage(file) {
    if (!canProfile() || busy() || state.uncertainties.profile || !file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      !file.size ||
      file.size > 8 * 1024 * 1024
    ) {
      state.uploadError = !file.size
        ? "Choose an image that isn’t empty."
        : file.size > 8 * 1024 * 1024
          ? "Choose an image smaller than 8 MB."
          : "Choose a JPG, PNG or WebP image.";
      render();
      return;
    }
    const ticket = generation;
    state.uploading = true;
    state.uploadError = "";
    render();
    try {
      const createAuthority = await authorize("profile");
      const upload = adminUpload(
        await call(
          "/api/uploads/create",
          {
            method: "POST",
            body: {
              type: "image",
              fileName: file.name,
              fileSize: file.size,
              contentType: file.type,
            },
            beforeDispatch: () =>
              guardAuthority(createAuthority, ticket, "profile"),
          },
          "profile",
        ),
      );
      const uploadAuthority = await authorize("profile");
      guardAuthority(uploadAuthority, ticket, "profile");
      const form = new FormData();
      for (const [name, value] of Object.entries(upload.fields))
        form.append(name, String(value));
      form.append(upload.fileFieldName, file, file.name);
      state.uploadController = new AbortController();
      guardAuthority(uploadAuthority, ticket, "profile");
      const response = await fetch(upload.uploadUrl, {
        method: "POST",
        body: form,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: state.uploadController.signal,
      });
      guard(ticket, "profile");
      if (!response.ok)
        throw new Error(`Image upload failed (${response.status}). Try again.`);
      state.profile.imageUrl = upload.deliveryUrl;
      delete state.errors.imageUrl;
      toast("Image uploaded. Save the profile to apply it.");
    } catch (error) {
      if (!error.stale && ticket === generation)
        state.uploadError = error.message || "The image could not be uploaded.";
    } finally {
      if (ticket === generation) {
        state.uploading = false;
        state.uploadController = null;
        render();
      }
    }
  }
  function eventCurrent() {
    if (!sync()) return false;
    return Boolean(host && identity() === state.key);
  }
  function onInput(event) {
    if (!host?.contains(event.target) || !eventCurrent()) return;
    const field = event.target;
    if (
      field.closest("#profile-form") &&
      field.name &&
      canProfile() &&
      !busy() &&
      !currentUncertain()
    ) {
      state.profile[field.name] =
        field.type === "checkbox" ? field.checked : field.value;
      delete state.errors[field.name];
      field.removeAttribute("aria-invalid");
      q(`#error-${field.name}`)?.remove();
      if (field.name === "pacAssociated") {
        q("[data-pac-field]").hidden = !field.checked;
        q('[name="fecNumber"]').required = field.checked;
        if (field.checked) q('[name="fecNumber"]').focus();
      }
      updateSaveStatus();
    }
    if (
      field.closest("#script-form") &&
      canScripts() &&
      !busy() &&
      !currentUncertain()
    ) {
      if (field.name === "scriptTitle")
        state.scripts[state.channel].title = field.value.slice(0, 120);
      if (field.name === "scriptBody")
        state.scripts[state.channel].body = field.value.slice(0, 5000);
      updateScriptPreview();
      updateSaveStatus();
    }
  }
  function onClick(event) {
    const el = event.target.closest("[data-admin-action]");
    if (!el || !host?.contains(el) || el.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (!eventCurrent()) return;
    const action = el.dataset.adminAction;
    if (action === "tab" && !busy()) {
      state.tab = el.dataset.tab;
      state.message = "";
      state.errors = {};
      render();
      q(`#admin-tab-${state.tab}`)?.focus();
      if (state.tab === "outreach" && !state.scriptsLoaded) void readScripts();
    } else if (action === "channel") {
      state.channel = el.dataset.channel;
      render();
      q(`[data-channel="${state.channel}"]`)?.focus();
    } else if (action === "save") void saveCurrent();
    else if (action === "preview-profile" && state.loaded) previewProfile();
    else if (action === "choose-image" && canProfile() && !busy()) {
      const file = q("#organization-image");
      file.value = "";
      file.click();
    } else if (action === "image-url") showImageUrl();
    else if (action === "apply-image-url") applyImageUrl();
    else if (action === "close-dialog") closeDialog();
    else if (action === "confirm-action") {
      const accept = confirmation?.accept;
      closeDialog({ cancel: false });
      accept?.();
    } else if (action === "refresh-scripts") reloadCurrent("outreach");
    else if (action === "reload-current") reloadCurrent();
    else if (action === "retry") void load({ refresh: true });
    else if (action === "check-save") void checkSaved();
    else if (action === "insert-token") insertToken(el.dataset.token);
    else if (action === "handoff-people")
      navigate?.(
        `/coalitions/${encodeURIComponent(current().coalitionId)}/members`,
      );
  }
  function onChange(event) {
    if (
      host?.contains(event.target) &&
      eventCurrent() &&
      event.target.id === "organization-image"
    )
      void chooseImage(event.target.files?.[0]);
  }
  function onSubmit(event) {
    if (!host?.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!eventCurrent()) return;
    if (event.target.id === "image-url-form") applyImageUrl();
    else void saveCurrent();
  }
  function onKeydown(event) {
    if (!host?.contains(event.target) || !eventCurrent() || busy()) return;
    const tab = event.target.closest('#view-tabs [role="tab"]');
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    state.tab =
      event.key === "Home"
        ? "profile"
        : event.key === "End"
          ? "outreach"
          : state.tab === "profile"
            ? "outreach"
            : "profile";
    render();
    q(`#admin-tab-${state.tab}`).focus();
    if (state.tab === "outreach" && !state.scriptsLoaded) void readScripts();
  }
  function markup() {
    sync();
    return "<div data-coalition-administration-host></div>";
  }
  function beforeRender() {
    const active = document.activeElement;
    if (host?.contains(active))
      focusSnapshot = {
        element: active,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
  }
  function mount(root) {
    const placeholder = root.querySelector(
      "[data-coalition-administration-host]",
    );
    if (!placeholder || !sync()) {
      if (host && !placeholder) reset();
      return;
    }
    if (!host) {
      host = document.createElement("section");
      host.className = "coalition-administration-page";
      host.setAttribute("aria-label", "Administration workspace");
      host.addEventListener("click", onClick);
      host.addEventListener("input", onInput);
      host.addEventListener("change", onChange);
      host.addEventListener("submit", onSubmit);
      host.addEventListener("keydown", onKeydown);
      host.addEventListener(
        "cancel",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        },
        true,
      );
      render();
    }
    placeholder.replaceWith(host);
    for (const dialog of host.querySelectorAll("dialog[open]"))
      if (!dialog.matches(":modal")) {
        dialog.close();
        dialog.showModal();
      }
    if (focusSnapshot?.element?.isConnected) {
      focusSnapshot.element.focus({ preventScroll: true });
      try {
        if (typeof focusSnapshot.start === "number")
          focusSnapshot.element.setSelectionRange(
            focusSnapshot.start,
            focusSnapshot.end,
          );
      } catch {
        /* Input has no caret. */
      }
    }
    focusSnapshot = null;
    if (!state.loaded && !flight && state.condition !== "denied") void load();
  }
  function beforeNavigate(path, proceed) {
    if (!host || !state.key || identity() !== state.key) return true;
    const url = new URL(path, window.location.origin);
    const prefix = `/coalitions/${encodeURIComponent(current().coalitionId)}/admin/edit`;
    const sameAdmin =
      url.origin === window.location.origin &&
      [
        prefix,
        `${prefix}/`,
        `${prefix}/outreach`,
        `${prefix}/outreach/`,
      ].includes(url.pathname);
    if (busy()) {
      toast("Wait for the current change to finish before leaving.");
      return false;
    }
    if (sameAdmin || state.allowedNavigation === path) {
      state.allowedNavigation = "";
      return true;
    }
    if (!dirty() && !anyUncertain()) return true;
    confirmAction(
      "Leave Administration?",
      "Your unsaved changes will be discarded.",
      "Leave section",
      () => {
        state.allowedNavigation = path;
        proceed();
      },
    );
    return false;
  }
  function acceptSession() {
    const c = current();
    if (!c || identity(c) !== state.key) {
      reset();
      return;
    }
    if (c.sessionKey === state.credential) return;
    generation++;
    loadSequence++;
    flight = null;
    state.scriptsLoading = false;
    if (state.writeIntent?.dispatched)
      state.uncertainties[state.writeIntent.kind] = state.writeIntent;
    state.writeIntent = null;
    state.saving = "";
    state.uploadController?.abort();
    state.uploading = false;
    state.credential = c.sessionKey;
  }
  function sessionUnavailable(message) {
    if (!sync()) return;
    state.message =
      message || "Unable to renew your session right now. Please try again.";
    if (!state.loaded) state.condition = "error";
    render();
  }
  window.addEventListener("beforeunload", (event) => {
    if (host && identity() === state.key && (dirty() || anyUncertain())) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener(
    "popstate",
    (event) => {
      const session = account?.() || current();
      if (
        !host ||
        !session?.userId ||
        !state.key.startsWith(`${session.userId}|`) ||
        session.sessionKey !== state.credential ||
        (!dirty() && !anyUncertain() && !busy())
      )
        return;
      const destination = window.location.pathname + window.location.search;
      if (destination === state.path) return;
      const scopeId = state.key.slice(state.key.indexOf("|") + 1);
      const prefix = `/coalitions/${encodeURIComponent(scopeId)}/admin/edit`;
      if (
        !busy() &&
        (window.location.pathname === prefix ||
          window.location.pathname === `${prefix}/outreach`)
      )
        return;
      event.stopImmediatePropagation();
      window.history.pushState({}, document.title, state.path);
      const proceed = () => navigate?.(destination, { replace: true });
      if (beforeNavigate(destination, proceed)) proceed();
    },
    true,
  );
  return {
    markup,
    mount,
    beforeRender,
    load,
    reset,
    beforeNavigate,
    acceptSession,
    sessionUnavailable,
  };
}
