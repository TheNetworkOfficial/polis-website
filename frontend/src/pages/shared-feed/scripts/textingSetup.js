import { escapeText as e, count, notice } from "./textingWorkspaceUi";
import { textingRoute } from "./textingShell";
import { textingBlocker } from "./textingReadinessStatus";
import { textingSetupActivation } from "./textingSetupTransport";
import { createTextingSetupRecovery } from "./textingSetupRecovery";

const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const rows = (value) => (Array.isArray(value) ? value : []);
const stateCopy = {
  draft: [
    "Review your setup",
    "Review the saved message, recipients and team before preparing.",
  ],
  preparing: [
    "Preparing selected recipients",
    "Your request is saved. You can leave this page and return. No messages are being sent.",
  ],
  ready: [
    "Ready to open",
    "Recipient preparation is complete. Review the campaign, then open it for your volunteers.",
  ],
  prepared: [
    "Ready to open",
    "Recipient preparation is complete. Review the campaign, then open it for your volunteers.",
  ],
  published: [
    "Continue opening your campaign",
    "The prepared campaign is saved. Continue the same request to open it.",
  ],
  opening: [
    "Opening campaign",
    "Texting access is being prepared for assigned volunteers. No messages are being sent.",
  ],
  active: [
    "Ready to text",
    "The campaign is open. Each individual message still needs a person's confirmation.",
  ],
  complete: [
    "Ready to text",
    "The campaign is open. Each individual message still needs a person's confirmation.",
  ],
  needs_attention: [
    "Preparation needs attention",
    "Your selection and saved progress are retained. Check the saved status before continuing.",
  ],
  handed_off: [
    "Ready to text",
    "The campaign is open. Each individual message still needs a person's confirmation.",
  ],
  reconciliation_required: [
    "Checking a previous operation",
    "The previous operation needs reconciliation before another upload or opening request. Your saved selection is retained.",
  ],
};
const setupError = (error) =>
  ({
    setup_unavailable:
      "New campaign setup is unavailable. Existing campaigns and texting remain available.",
    setup_handoff_invalid:
      "The saved campaign handoff could not be verified. Check its status before continuing.",
  })[error?.message] ||
  ([401, 403].includes(error?.status)
    ? "Your setup access could not be confirmed. Check your current organization permissions."
    : "The saved result could not be confirmed. Check setup status before trying again.");

/** Isolated setup controller. Status reads never prepare, publish, activate, allocate or send. */
export function createTextingSetupPage({
  request,
  legacyRequest,
  context,
  changed,
  navigate,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let view = {},
    sequence = 0,
    timer;
  const recovery = createTextingSetupRecovery({ context });
  const identity = () => {
    const c = context();
    return c?.userId && c?.organizationId
      ? `${c.userId}:${c.organizationId}:${c.resourceId || ""}`
      : "";
  };
  const current = (key, ticket) =>
    key && identity() === key && view.key === key && sequence === ticket;
  const base = () =>
    `/api/texting/setup/coalition/${encodeURIComponent(context().organizationId)}`;
  const button = (action, text, disabled = false) =>
    `<button class="pt-btn" type="button" data-setup-action="${e(action)}"${disabled || view.busy ? " disabled" : ""}>${e(text)}</button>`;
  const guard = (key, ticket) => {
    if (!current(key, ticket)) throw new Error("setup_context_changed");
  };
  const send = (path, options = {}) => {
    const key = view.key,
      ticket = sequence;
    return request(path, {
      ...options,
      beforeRequest: () => guard(key, ticket),
    });
  };
  function reset() {
    sequence++;
    cancel(timer);
    view = {};
  }
  function accept(result) {
    const setup = result.setup || result.draft;
    if (!validId(setup?.setupId) || !Number.isSafeInteger(setup.revision))
      throw new Error("setup_status_invalid");
    if (
      view.setup &&
      (view.setup.setupId !== setup.setupId ||
        view.setup.revision > setup.revision)
    )
      throw new Error("setup_status_changed");
    view.setup = setup;
    view.uncertain = false;
  }
  async function recoverCreation(key, ticket) {
    try {
      const result = await send(
        `${base()}/requests/${encodeURIComponent(view.creationPending)}`,
        { auth: true },
      );
      guard(key, ticket);
      accept(result);
      recovery.clear();
      view.creationPending = null;
      navigate("setup", view.setup.setupId);
    } catch (error) {
      guard(key, ticket);
      if (
        error.status === 404 &&
        error.payload?.error === "texting_setup_request_not_found"
      ) {
        // A slow prior request may still finish. Retain the SAME identity even after a 404.
        view.uncertain = false;
        view.error =
          "No saved setup was found yet. Check again before saving; Save will keep the same recovery request.";
      } else throw error;
    }
  }
  function poll() {
    cancel(timer);
    if (
      !view.busy &&
      (view.setup?.state === "preparing" ||
        view.setup?.handoff?.state === "accepted") &&
      (view.polls || 0) < 180
    )
      timer = schedule(() => {
        view.polls = (view.polls || 0) + 1;
        void refresh();
      }, 5000);
  }
  async function load({ force = false } = {}) {
    const key = identity();
    if (!key || (!force && view.key === key)) return;
    reset();
    const ticket = sequence;
    view = { key, loading: true, polls: 0 };
    changed();
    try {
      const result = await send(base(), { auth: true });
      guard(key, ticket);
      if (result.capabilities?.isolatedSetup !== true)
        throw new Error("setup_unavailable");
      view.discovery = result;
      if (!context().resourceId || context().resourceId === "new") {
        const pending = recovery.read();
        if (pending) {
          view.creationPending = view.requestId = pending;
          view.uncertain = true;
          await recoverCreation(key, ticket);
        }
      }
      if (context().resourceId && context().resourceId !== "new") {
        if (!validId(context().resourceId))
          throw new Error("setup_route_invalid");
        const saved = await send(
          `${base()}/drafts/${encodeURIComponent(context().resourceId)}`,
          { auth: true },
        );
        guard(key, ticket);
        accept(saved);
      }
    } catch (error) {
      if (current(key, ticket)) {
        view.error = setupError(error);
        view.denied = [401, 403].includes(error.status);
        if (view.denied) {
          view.discovery = null;
          view.setup = null;
        }
      }
    } finally {
      if (current(key, ticket)) {
        view.loading = false;
        changed();
        poll();
      }
    }
  }
  async function refresh() {
    if (!view.key || view.busy || view.loading) return;
    const key = view.key,
      ticket = sequence;
    view.busy = true;
    changed();
    try {
      if (view.creationPending) {
        await recoverCreation(key, ticket);
        return;
      }
      const suffix = view.setup
        ? `/drafts/${encodeURIComponent(view.setup.setupId)}`
        : "";
      const result = await send(`${base()}${suffix}`, { auth: true });
      guard(key, ticket);
      if (suffix) accept(result);
      else view.discovery = result;
      view.error = "";
    } catch (error) {
      if (current(key, ticket)) {
        view.error = setupError(error);
        if (view.creationPending) view.uncertain = true;
        if ([401, 403].includes(error.status)) {
          view.setup = null;
          view.discovery = null;
          view.denied = true;
        }
      }
    } finally {
      if (current(key, ticket)) {
        view.busy = false;
        changed();
        poll();
      }
    }
  }
  async function more() {
    const cursor = view.discovery?.nextCursor;
    if (
      view.busy ||
      view.loading ||
      view.setup ||
      typeof cursor !== "string" ||
      cursor.length > 4096 ||
      !/^[A-Za-z0-9_.-]+$/.test(cursor)
    )
      return;
    const key = view.key,
      ticket = sequence;
    view.busy = true;
    changed();
    try {
      const result = await send(
        `${base()}?cursor=${encodeURIComponent(cursor)}`,
        { auth: true },
      );
      guard(key, ticket);
      const saved = new Map(
        rows(view.discovery.setups).map((item) => [item.setupId, item]),
      );
      for (const item of rows(result.setups))
        if (validId(item.setupId)) saved.set(item.setupId, item);
      view.discovery = {
        ...view.discovery,
        ...result,
        setups: [...saved.values()],
      };
      view.error = "";
    } catch (error) {
      if (current(key, ticket)) {
        view.error = setupError(error);
        if ([401, 403].includes(error.status)) {
          view.discovery = null;
          view.denied = true;
        }
      }
    } finally {
      if (current(key, ticket)) {
        view.busy = false;
        changed();
      }
    }
  }
  async function act(action) {
    if (view.busy || view.loading || !view.setup || view.uncertain) return;
    const permissions = {
      prepare: "canPrepare",
      resume: "canResume",
      takeover: "canTakeover",
      reconcile: "canReconcile",
      open: "canPublish",
    };
    if (action !== "open" && view.setup[permissions[action]] !== true) return;
    if (
      action === "open" &&
      view.setup.canPublish !== true &&
      !view.setup.handoff?.action
    )
      return;
    if (
      action === "takeover" &&
      !window.confirm(
        "Take over this saved preparation? Your current permissions and the exact saved selection will be checked. A new approval will be attributed to you; the earlier approval is retained.",
      )
    )
      return;
    if (
      action === "prepare" &&
      !window.confirm(
        "Prepare this exact saved selection and message? This shares the selected contacts with the texting service. It sends no messages.",
      )
    )
      return;
    if (
      action === "open" &&
      !window.confirm(
        "Open this reviewed campaign for the assigned volunteers? This sends no messages. Each individual text still needs human confirmation.",
      )
    )
      return;
    const key = view.key,
      ticket = sequence;
    view.busy = true;
    view.error = "";
    cancel(timer);
    changed();
    const update = async (name) => {
      const result = await send(
        `${base()}/drafts/${encodeURIComponent(view.setup.setupId)}/${name}`,
        {
          auth: true,
          method: "POST",
          body: { expectedRevision: view.setup.revision },
        },
      );
      guard(key, ticket);
      accept(result);
    };
    try {
      if (action !== "open") await update(action);
      else {
        if (view.setup.canPublish) await update("publish");
        if (!view.setup.handoff) return;
        await update("handoff");
        const fixed = textingSetupActivation(
          view.setup,
          context().organizationId,
        );
        if (fixed) {
          await legacyRequest(fixed.path, {
            auth: true,
            method: fixed.method,
            body: fixed.body,
            beforeRequest: () => guard(key, ticket),
          });
          guard(key, ticket);
          // Read back the same operation. A fresh campaign revision is never substituted.
          const result = await send(
            `${base()}/drafts/${encodeURIComponent(view.setup.setupId)}`,
            { auth: true },
          );
          guard(key, ticket);
          accept(result);
        }
      }
    } catch (error) {
      if (current(key, ticket)) {
        view.uncertain = true;
        view.error = setupError(error);
      }
    } finally {
      if (current(key, ticket)) {
        view.busy = false;
        changed();
        poll();
      }
    }
  }
  async function create(form) {
    if (
      view.busy ||
      view.uncertain ||
      view.discovery?.capabilities?.createSetup !== true ||
      view.discovery?.capabilities?.manageBilling !== true
    )
      return;
    const values = new FormData(form),
      audienceId = values.get("audienceId");
    if (
      !rows(view.discovery.availableAudiences).some(
        (row) => row.audienceId === audienceId,
      )
    )
      return;
    const dollars = String(values.get("budget") || "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(dollars)) return;
    const budgetMicros = Math.round(Number(dollars) * 1000000);
    if (!Number.isSafeInteger(budgetMicros) || budgetMicros <= 0) return;
    const body = {
      requestId: (view.requestId ||= crypto.randomUUID()),
      name: String(values.get("name") || "").trim(),
      audienceId,
      templateText: String(values.get("templateText") || "").trim(),
      mediaId: null,
      budgetMicros,
      deliveryNotBeforeMs: new Date(values.get("start")).getTime(),
      deliveryBeforeMs: new Date(values.get("end")).getTime(),
      assignedUserIds: rows(view.discovery.volunteers)
        .filter((row) => values.getAll("volunteer").includes(row.userId))
        .map((row) => row.userId),
    };
    if (!body.assignedUserIds.length) {
      view.formError =
        "Choose at least one eligible volunteer before saving this exact setup.";
      changed();
      return;
    }
    if (
      !body.name ||
      !body.templateText ||
      !Number.isSafeInteger(body.deliveryNotBeforeMs) ||
      !Number.isSafeInteger(body.deliveryBeforeMs) ||
      body.deliveryBeforeMs <= body.deliveryNotBeforeMs
    ) {
      view.formError =
        "Enter a campaign name and message, and a sending end after the start.";
      changed();
      return;
    }
    const key = view.key,
      ticket = sequence;
    view.busy = true;
    view.formError = "";
    view.creationPending = body.requestId;
    recovery.save(body.requestId);
    changed();
    try {
      const result = await send(`${base()}/drafts`, {
        auth: true,
        method: "POST",
        body,
      });
      guard(key, ticket);
      accept(result);
      recovery.clear();
      view.creationPending = null;
      navigate("setup", view.setup.setupId);
    } catch (error) {
      if (current(key, ticket)) {
        view.uncertain = true;
        view.error =
          "Your setup may have been saved. Check saved setups before creating another one.";
        if ([401, 403].includes(error.status)) {
          view.discovery = null;
          view.setup = null;
          view.error = setupError(error);
        }
      }
    } finally {
      if (current(key, ticket)) {
        view.busy = false;
        changed();
      }
    }
  }
  function readiness(value) {
    return Object.entries(value || {})
      .filter(
        ([kind, status]) =>
          ["purchase", "sending", "preparation", "volunteerAccess"].includes(
            kind,
          ) &&
          status &&
          typeof status === "object",
      )
      .map(
        ([kind, status]) =>
          `<section><h3>${e({ purchase: "Purchasing", sending: "Sending", preparation: "Recipient preparation", volunteerAccess: "Volunteer access" }[kind] || "Setup")}</h3><p>${e({ ready: "Ready", blocked: "Needs attention", pending: "In progress", unavailable: "Status unavailable" }[status.state] || "Status unavailable")}</p>${rows(
            status.blockers,
          )
            .map((item) => {
              const issue = textingBlocker(item);
              return `<p>${e(issue.message)} ${e(issue.owner)} owns this step.</p>`;
            })
            .join("")}</section>`,
      )
      .join("");
  }
  function savedReview(draft) {
    const selected = rows(view.discovery.availableAudiences).find(
      (row) => row.audienceId === draft.audienceId,
    );
    const team = rows(draft.assignedUserIds).map((userId) => {
      const member = rows(view.discovery.volunteers).find(
        (row) => row.userId === userId,
      );
      return member?.displayName || member?.username || "Assigned volunteer";
    });
    const dates = [draft.deliveryNotBeforeMs, draft.deliveryBeforeMs];
    return `<dl>${selected ? `<dt>Recipient selection</dt><dd>${e(selected.name || "Reviewed selection")} · ${count(selected.count)} recipients</dd>` : ""}${team.length ? `<dt>Assigned volunteers</dt><dd>${team.map(e).join(", ")}</dd>` : ""}${dates.every((value) => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000) ? `<dt>Sending window</dt><dd>${dates.map((value) => e(new Date(value).toLocaleString())).join(" – ")}</dd>` : ""}${view.discovery.capabilities.manageBilling === true && Number.isSafeInteger(draft.budgetMicros) ? `<dt>Campaign spending limit</dt><dd>${e(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(draft.budgetMicros / 1000000))}</dd>` : ""}</dl>`;
  }
  function captureCreate(form) {
    const values = new FormData(form);
    view.formValues = Object.fromEntries(
      ["name", "audienceId", "templateText", "budget", "start", "end"].map(
        (key) => [key, String(values.get(key) || "")],
      ),
    );
    view.formValues.volunteers = values.getAll("volunteer");
  }
  function render() {
    if (!identity()) return notice("Sign in to your organization to continue.");
    if (view.key !== identity() || view.loading)
      return notice("Loading campaign setup…");
    const fallback = `<a class="pt-btn pt-btn--secondary" href="${e(textingRoute(context().organizationId, "campaigns"))}" data-action="navigate" data-route="${e(textingRoute(context().organizationId, "campaigns"))}">Existing campaigns</a>${!view.setup && !view.creationPending && ["enabled", "unsupported"].includes(view.discovery?.setupAvailability?.state) ? `<a class="pt-btn pt-btn--secondary" href="${e(textingRoute(context().organizationId, "campaigns", "new"))}" data-action="navigate" data-route="${e(textingRoute(context().organizationId, "campaigns", "new"))}">Other campaign types</a>` : ""}`;
    let html = `<header class="pt-page-head"><div><div class="pt-eyebrow">CAMPAIGN SETUP</div><h1>Prepare your next conversation</h1><p>Saved setup is separate from campaigns already texting.</p></div>${fallback}</header>${view.error ? `<div role="alert">${notice(view.error)}</div>` : ""}${button("refresh", view.setup ? "Check setup status" : "Check saved setups")}`;
    if (!view.discovery || view.denied) return html;
    const s = view.setup;
    if (s) {
      const copy =
        s.handoff?.state === "changed"
          ? [
              "Campaign changed after review",
              "Review the current campaign before opening it. The previous opening request will not overwrite those changes.",
            ]
          : s.handoff?.state === "reconciliation_required"
            ? stateCopy.reconciliation_required
            : s.handoff?.state === "accepted"
              ? stateCopy.opening
              : s.phase === "publishing_records"
                ? [
                    "Preparing campaign records",
                    "Publication progress is saved. Continue the same reviewed opening request when ready.",
                  ]
                : stateCopy[s.state] || [
                    "Check saved preparation",
                    "Your saved setup is retained. Check its status for the next permitted action.",
                  ];
      const draft = s.draft || {};
      const ready = s.handoff?.state === "complete";
      html += `<section class="pt-card" aria-label="Saved campaign setup">${notice(copy[0], copy[1])}<h2>${e(draft.name || s.name || "Saved campaign")}</h2>${draft.templateText ? `<div class="pt-workspace-bubble"><p>${e(draft.templateText)}</p></div>` : ""}${savedReview(draft)}<p>Selected recipients: ${count(s.progress?.selected)} · Submitted: ${count(s.progress?.submitted)} · Confirmed ready: ${count(s.progress?.verified)}</p>${Number.isSafeInteger(s.updatedAtMs) ? `<p>Last saved update: ${e(new Date(s.updatedAtMs).toLocaleString())}</p>` : ""}${view.uncertain ? notice("Check the saved result", "Status checks do not repeat preparation or opening requests.") : ""}<div class="pt-actions">${s.canPrepare === true ? button("prepare", "Prepare selected recipients", view.uncertain) : ""}${s.canResume === true ? button("resume", "Resume saved preparation", view.uncertain) : ""}${s.canTakeover === true ? button("takeover", "Take over preparation", view.uncertain) : ""}${s.canReconcile === true ? button("reconcile", "Check preparation status", view.uncertain) : ""}${s.canPublish === true || (s.handoff?.action && !ready) ? button("open", s.handoff ? "Continue opening" : "Review and open campaign", view.uncertain) : ""}${ready && validId(s.campaignId) ? `<a class="pt-btn" href="${e(textingRoute(context().organizationId, "send", s.campaignId))}" data-action="navigate" data-route="${e(textingRoute(context().organizationId, "send", s.campaignId))}">Start texting</a>` : ""}</div>${s.handoff && validId(s.campaignId) && !ready ? `<a class="pt-btn pt-btn--secondary" href="${e(textingRoute(context().organizationId, "campaigns", s.campaignId))}" data-action="navigate" data-route="${e(textingRoute(context().organizationId, "campaigns", s.campaignId))}">View campaign status</a>` : ""}${view.polls >= 180 ? notice("Automatic checks are paused", "Your saved setup is retained. Check setup status to see the latest progress.") : ""}${readiness(s.readiness)}</section>`;
      return html;
    }
    html += rows(view.discovery.setups)
      .filter((item) => validId(item.setupId))
      .map(
        (item) =>
          `<section class="pt-card"><h2>${e(item.name || item.draft?.name || "Saved campaign setup")}</h2><p>${e(stateCopy[item.state]?.[0] || "Saved setup")}</p><a class="pt-btn" href="${e(textingRoute(context().organizationId, "setup", item.setupId))}" data-action="navigate" data-route="${e(textingRoute(context().organizationId, "setup", item.setupId))}">Continue saved setup</a></section>`,
      )
      .join("");
    if (
      typeof view.discovery.nextCursor === "string" &&
      view.discovery.nextCursor.length <= 4096 &&
      /^[A-Za-z0-9_.-]+$/.test(view.discovery.nextCursor)
    )
      html += button("more", "Load more saved setups");
    if (view.discovery.capabilities.createSetup !== true)
      return (
        html +
        notice(
          view.discovery.setupAvailability?.state === "paused"
            ? "New campaign setup is paused"
            : "New setup is not enabled",
          "Continue your saved setups or check their status. Existing campaigns remain available.",
        )
      );
    if (view.discovery.capabilities.manageBilling !== true)
      return (
        html +
        notice(
          "An organization administrator can create a funded setup",
          "You can continue the saved preparation actions your current permissions allow.",
        )
      );
    const audiences = rows(view.discovery.availableAudiences).filter((item) =>
      validId(item.audienceId),
    );
    if (!audiences.length)
      return (
        html +
        notice(
          "No reviewed recipient selection is available",
          "Review a contact selection before creating a new setup. Existing campaigns remain available.",
        )
      );
    const f = view.formValues || {};
    html += `<form class="pt-card pt-form" data-setup-form="draft"><h2>New campaign setup</h2><label for="setup-name">Campaign name</label><input id="setup-name" name="name" value="${e(f.name || "")}" required maxlength="200" ${view.busy || view.uncertain ? "disabled" : ""}><label for="setup-audience">Reviewed recipient selection</label><select id="setup-audience" name="audienceId" required>${audiences.map((item) => `<option value="${e(item.audienceId)}"${f.audienceId === item.audienceId ? " selected" : ""}>${e(item.name || "Reviewed selection")} · ${count(item.count)} recipients</option>`).join("")}</select><label for="setup-message">Message</label><textarea id="setup-message" name="templateText" required maxlength="10000">${e(f.templateText || "")}</textarea><label for="setup-budget">Campaign spending limit ($)</label><input id="setup-budget" name="budget" value="${e(f.budget || "")}" type="number" min="0.01" step="0.01" required><label for="setup-start">Sending starts</label><input id="setup-start" name="start" value="${e(f.start || "")}" type="datetime-local" required><label for="setup-end">Sending ends</label><input id="setup-end" name="end" value="${e(f.end || "")}" type="datetime-local" required><fieldset><legend>Campaign volunteers</legend>${rows(
      view.discovery.volunteers,
    )
      .filter((item) => validId(item.userId))
      .map(
        (item) =>
          `<label><input type="checkbox" name="volunteer" value="${e(item.userId)}"${rows(f.volunteers).includes(item.userId) ? " checked" : ""}>${e(item.displayName || item.username || "Organization member")}${item.username ? ` · @${e(item.username.replace(/^@+/, ""))}` : ""}</label>`,
      )
      .join(
        "",
      )}</fieldset><p>Saving freezes this exact message, selection, team and limits for review. Review all details before preparing. Preparation and opening send no messages; each individual text still needs human confirmation.</p>${view.formError ? `<p role="alert">${e(view.formError)}</p>` : ""}<button class="pt-btn" type="submit" ${view.busy || view.uncertain ? "disabled" : ""}>${view.busy ? "Saving…" : "Save setup draft"}</button></form>`;
    return html;
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-setup-action]");
    if (!target || target.disabled || identity() !== view.key) return;
    if (target.dataset.setupAction === "refresh") void refresh();
    else if (target.dataset.setupAction === "more") void more();
    else void act(target.dataset.setupAction);
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches?.('[data-setup-form="draft"]') || identity() !== view.key)
      return;
    event.preventDefault();
    captureCreate(form);
    if (form.reportValidity()) void create(form);
  });
  document.addEventListener("input", (event) => {
    const form = event.target.closest?.('[data-setup-form="draft"]');
    if (form && identity() === view.key && !view.busy) captureCreate(form);
  });
  return {
    load,
    reset,
    refresh,
    render,
    getMeta: () => ({
      authorizationStatus: view.denied
        ? "denied"
        : view.discovery
          ? "ready"
          : "pending",
      capabilities: view.discovery?.capabilities || {},
    }),
  };
}
