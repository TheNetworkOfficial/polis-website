import "../css/texting-messaging.css";
import {
  escapeText as e,
  label,
  money,
  count,
  id,
  list,
  button,
  go,
  head,
  stat,
  notice,
  reasons,
  queueCanConfirm,
} from "./textingWorkspaceUi";
import { createContacts } from "./textingContacts";
import { createCampaigns } from "./textingCampaigns";
import { createConversations } from "./textingConversations";

/** Authenticated customer workspace. Every async result is fenced to both user and route. No provider work runs during reads. */
export function createTextingWorkspacePage({
  request,
  context,
  changed,
  navigate,
}) {
  let view = {},
    sequence = 0,
    modules = {},
    timer,
    upload,
    entryActor = "",
    fundsDismissed = false;
  const sendHolds = new Set();
  const holdStorage = (key) => `polis.texting.uncertain.${key}`;
  function hasHold(key) {
    try {
      return (
        sendHolds.has(key) || sessionStorage.getItem(holdStorage(key)) === "1"
      );
    } catch {
      return sendHolds.has(key);
    }
  }
  function storeHold(key) {
    sendHolds.add(key);
    try {
      sessionStorage.setItem(holdStorage(key), "1");
    } catch {
      /* In-memory fence remains active if browser storage is disabled. */
    }
  }
  function clearHold(key) {
    sendHolds.delete(key);
    try {
      sessionStorage.removeItem(holdStorage(key));
    } catch {
      /* The server still enforces its durable send fence. */
    }
  }
  const identity = () => {
    const c = context();
    return c?.organizationId && c?.userId
      ? `${c.userId}:${c.organizationId}:${c.section || "home"}:${c.resourceId || ""}`
      : "";
  };
  const actorIdentity = () => {
    const c = context();
    return c?.organizationId && c?.userId
      ? `${c.userId}:${c.organizationId}`
      : "";
  };
  const current = (key, version) =>
    key && identity() === key && view.key === key && sequence === version;
  function clearView() {
    sequence++;
    clearTimeout(timer);
    for (const module of Object.values(modules)) module.dispose?.();
    upload?.abort();
    upload = null;
    view = {};
    modules = {};
  }
  function reset() {
    clearView();
    entryActor = "";
    fundsDismissed = false;
  }
  const can = (name) =>
    view.workspace?.status === "configured" &&
    view.workspace.capabilities?.[name] === true;
  function fail(error) {
    if (error?.status === 401 || error?.status === 403) {
      for (const module of Object.values(modules)) module.dispose?.();
      view.workspace = null;
      view.billing = null;
      view.contacts = null;
      view.campaigns = null;
      view.conversations = null;
      view.error =
        error?.status === 401
          ? "Your session could not be refreshed. Please sign in again."
          : "Your access has changed. Refresh to check your organization permissions.";
    } else
      view.error =
        error?.message ||
        "The saved status could not be confirmed. Refresh before trying again.";
  }
  function runtime(key, version) {
    const organizationId = context().organizationId,
      actor = actorIdentity();
    const guard = () => {
      if (!current(key, version))
        throw new Error("Workspace changed; previous operation stopped.");
    };
    const api = async (suffix, body, method) => {
      guard();
      const result = await request(
        `/api/text-banking/prompt/scopes/${id(`coalition:${organizationId}`)}${suffix}`,
        {
          auth: true,
          beforeRequest: guard,
          ...(body === undefined ? {} : { method: method || "POST", body }),
        },
      );
      guard();
      if (result?.ok !== true)
        throw new Error("The workspace response could not be verified.");
      return result;
    };
    const refreshBilling = async () => {
      view.billing = (await api("/billing/summary")).billing;
    };
    return {
      api,
      guard,
      fail,
      refreshBilling,
      context,
      can,
      view: () => view,
      workspace: () => view.workspace,
      billing: () => view.billing,
      busy: () => view.busy === true,
      changed: () => {
        guard();
        changed();
      },
      navigate: (section, resource) => {
        guard();
        navigate(section, resource);
      },
      toast: (message) => {
        guard();
        view.message = message;
      },
      sendHeld: (key) => hasHold(`${actor}:${key}`),
      holdSend: (key) => storeHold(`${actor}:${key}`),
      releaseSend: (key) => clearHold(`${actor}:${key}`),
      armExpiry: (ms) => {
        clearTimeout(timer);
        if (Number.isSafeInteger(ms))
          timer = setTimeout(
            () => {
              if (current(key, version)) changed();
            },
            Math.max(0, Math.min(2147483647, ms - Date.now() + 20)),
          );
      },
      newUploadController: () => {
        upload?.abort();
        upload = new AbortController();
        return upload;
      },
    };
  }
  async function load({ force = false } = {}) {
    const key = identity();
    if (!key) {
      reset();
      return;
    }
    if (view.key === key && (view.loading || (!force && view.workspace)))
      return;
    if (entryActor !== actorIdentity()) {
      entryActor = actorIdentity();
      fundsDismissed = false;
    }
    clearView();
    view = { key, loading: true };
    const version = sequence,
      r = runtime(key, version);
    modules = {
      contacts: createContacts(r),
      campaigns: createCampaigns(r),
      conversations: createConversations(r),
    };
    changed();
    try {
      const w = (await r.api("/workspace")).workspace;
      if (
        w?.scopeKey !== `coalition:${context().organizationId}` ||
        w.provider !== "prompt" ||
        w.manualOnly !== true ||
        !["configured", "provision_required"].includes(w.status)
      )
        throw new Error("The customer workspace could not be verified.");
      view.workspace = w;
      if (w.status !== "configured") return;
      await r.refreshBilling();
      const { section = "home", resourceId } = context();
      if (section === "contacts") {
        if (can("uploadImports")) await modules.contacts.load(resourceId);
      } else if (["campaigns", "team", "send", "results"].includes(section))
        await modules.campaigns.load(resourceId, section);
      else if (["inbox", "conversation"].includes(section))
        await modules.conversations.load(resourceId);
      else {
        const campaigns = await r.api("/campaigns?limit=5");
        view.homeCampaigns = list(campaigns.items);
      }
    } catch (error) {
      if (current(key, version)) fail(error);
    } finally {
      if (current(key, version)) {
        view.loading = false;
        changed();
      }
    }
  }
  async function refresh() {
    if (!view.key || view.loading || view.busy || !view.workspace) return;
    const key = view.key,
      version = sequence,
      r = runtime(key, version);
    try {
      const workspace = (await r.api("/workspace")).workspace;
      if (
        workspace?.scopeKey !== view.workspace.scopeKey ||
        workspace.manualOnly !== true
      )
        throw new Error("Workspace status could not be verified.");
      view.workspace = workspace;
      if (workspace.status === "configured") await r.refreshBilling();
    } catch (error) {
      if (current(key, version)) fail(error);
    } finally {
      if (current(key, version)) changed();
    }
  }
  async function run(operation) {
    if (view.busy || view.loading || identity() !== view.key) return;
    const key = view.key,
      version = sequence;
    view.busy = true;
    view.error = "";
    view.message = "";
    changed();
    try {
      await operation();
    } catch (error) {
      if (current(key, version)) fail(error);
    } finally {
      if (current(key, version)) {
        view.busy = false;
        changed();
      }
    }
  }
  function financialNotice() {
    const b = view.billing;
    if (!b) return "";
    const rates = [b.smsUpToTwoSegmentsMicros, b.mmsMicros].filter(
      (n) => Number.isSafeInteger(n) && n > 0,
    );
    const empty =
      b.availableMicros === 0 ||
      b.unfundedMicros > 0 ||
      (rates.length && rates.every((rate) => b.availableMicros < rate));
    if (b.billingHold)
      return notice(
        "Billing review needed",
        "Sending remains paused while this hold is reviewed.",
      );
    if (!empty || fundsDismissed) return "";
    return `<div class="pt-notice"><div class="pt-row"><strong>${b.canManageBilling ? "Time to add texting funds" : "Sending is paused"}</strong>${button("funds-dismiss", "Dismiss", { secondary: true })}</div><p>${b.canManageBilling ? "Keep conversations moving with a prepaid balance." : "Ask an organization administrator to add funds."}</p>${b.canManageBilling ? go("balance", "View balance") : ""}</div>`;
  }
  function home() {
    const w = view.workspace,
      b = view.billing,
      campaigns = list(view.homeCampaigns),
      ready = w.canSend === true;
    return (
      head(
        context().organizationName || "YOUR ORGANIZATION",
        "Good conversations start here.",
        "Your people. Your voice. One message at a time.",
        can("createCampaigns")
          ? go("campaigns", "New campaign", "new")
          : go("campaigns", "View campaigns"),
      ) +
      `<div class="pt-grid pt-grid--two"><section class="pt-card pt-workspace-hero"><div class="pt-eyebrow">BETTER, TOGETHER</div><h2>${ready ? "Make the next connection." : "Get ready for your first conversation."}</h2><p>${ready ? "Pick a campaign and give each message a personal moment." : "Your drafts and contact lists stay ready while texting setup is completed."}</p>${go("campaigns", ready ? "Open campaigns" : "Prepare a campaign")}</section><section class="pt-card"><div class="pt-eyebrow">TEXTING BALANCE</div><div class="pt-workspace-large">${money(b?.availableMicros)}</div><p class="pt-muted">Available to message</p>${go("balance", "View balance", "", true)}</section></div><div class="pt-grid pt-grid--three">${stat("Sending", ready ? (w.sendingMode === "pilot" ? "Controlled test" : "Available") : "Paused")}${stat("Pending charges", money(b?.reservedMicros))}${stat("Completed usage", money(b?.settledMicros))}</div><section class="pt-card"><div class="pt-row"><h2>Your campaigns</h2>${go("campaigns", "View all", "", true)}</div>${campaigns.length ? campaigns.map((c) => `<div class="pt-row"><div><strong>${e(c.name)}</strong><p class="pt-muted">${e(label(c.status))}</p></div>${go("campaigns", "Open", c.campaignId, true)}</div>`).join("") : `<p class="pt-muted">Create a campaign when your contact list is ready.</p>`}</section><div class="pt-grid pt-grid--two">${can("uploadImports") ? `<section class="pt-card"><h2>Bring your people</h2><p class="pt-muted">Upload and review a contact list.</p>${go("contacts", "Open contacts", "", true)}</section>` : ""}<section class="pt-card"><h2>Keep listening</h2><p class="pt-muted">Replies and opt-outs stay available when sends are paused.</p>${go("inbox", "Open inbox", "", true)}</section></div>`
    );
  }
  function render() {
    if (!identity()) return notice("Sign in to your organization to continue.");
    if (view.key !== identity() || view.loading)
      return `<div class="pt-card" role="status">Loading your texting workspace…</div>`;
    const section = context().section || "home",
      w = view.workspace;
    let html = "";
    if (!w)
      html =
        notice(
          "Workspace unavailable",
          "Refresh to check your current organization access.",
        ) + button("reload", "Refresh", { secondary: true });
    else if (w.status !== "configured")
      html =
        head("TEXTING", "Your workspace is being prepared") +
        notice(
          "Setup in progress",
          "Your registration details are saved. Organization messaging will appear here after workspace setup.",
        ) +
        go("registration", "View registration", "", true);
    else {
      if (section === "contacts") html = modules.contacts.render();
      else if (["campaigns", "team", "send", "results"].includes(section))
        html = modules.campaigns.render(section);
      else if (["inbox", "conversation"].includes(section))
        html = modules.conversations.render();
      else html = home();
      html = financialNotice() + html;
      if (!w.canSend)
        html += `<section class="pt-card"><strong>Sending is paused</strong><p class="pt-muted">You can prepare your work while the remaining setup is completed.</p>${reasons(w.blockedReasons)}</section>`;
      if (w.sendingMode === "pilot" && w.pilot)
        html += notice(
          "Controlled test",
          `${count(w.pilot.remainingMessages)} messages and ${money(w.pilot.remainingSpendMicros)} remain. Only approved test recipients can be contacted.`,
        );
    }
    const busyLabel = section === "contacts" ? "Updating import…" : "Saving…";
    return `<div data-workspace-key="${e(view.key)}" aria-busy="${view.busy ? "true" : "false"}">${view.error ? `<div class="pt-notice" role="alert">${e(view.error)}</div>` : ""}${view.message ? notice(view.message) : ""}${view.busy && !view.contacts?.starting ? `<div class="pt-workspace-working" role="status">${busyLabel}</div>` : ""}${html}</div>`;
  }
  function owned(target) {
    return (
      target?.closest?.("[data-workspace-key]")?.dataset.workspaceKey ===
        view.key && identity() === view.key
    );
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-workspace-action]");
    if (!target || !owned(target) || target.disabled) return;
    const action = target.dataset.workspaceAction;
    if (action === "upload-stop") {
      upload?.abort();
      return;
    }
    if (action === "funds-dismiss") {
      fundsDismissed = true;
      changed();
      return;
    }
    if (action === "navigate") {
      const [section, resource] = JSON.parse(target.dataset.value);
      navigate(section, resource);
      return;
    }
    if (action === "reload") {
      void load({ force: true });
      return;
    }
    void run(async () => {
      for (const module of Object.values(modules))
        if (await module.action(action, target.dataset.value)) return;
    });
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches?.("[data-workspace-form]") || !owned(form)) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    void run(async () => {
      for (const module of Object.values(modules))
        if (await module.submit(form.dataset.workspaceForm, form)) return;
    });
  });
  const onChange = (event) => {
    const target = event.target;
    if (!owned(target)) return;
    if (target.dataset.workspaceChange === "campaign-media") {
      const file = target.files?.[0];
      if (file) void run(() => modules.campaigns.mediaFile(file));
      return;
    }
    let rerender = false;
    for (const module of Object.values(modules))
      rerender = module.change(target) || rerender;
    if (
      rerender &&
      !["contact-file", "resume-file"].includes(target.dataset.workspaceChange)
    )
      changed();
    if (target.dataset.workspaceChange === "resume-file") {
      const button = target
        .closest("[data-workspace-key]")
        .querySelector('[data-workspace-action="upload-resume"]');
      if (button) button.disabled = !target.files?.length;
    }
  };
  document.addEventListener("change", onChange);
  document.addEventListener("input", (event) => {
    if (
      !owned(event.target) ||
      ["checkbox", "file"].includes(event.target.type)
    )
      return;
    let update = false;
    for (const module of Object.values(modules))
      update = module.change(event.target) || update;
    if (update) changed();
  });
  document.addEventListener(
    "load",
    (event) => {
      const target = event.target;
      if (!owned(target) || !target.dataset.workspaceQueueImage) return;
      if (
        target.naturalWidth > 0 &&
        view.campaigns?.queue?.items?.[0]?.itemId ===
          target.dataset.workspaceQueueImage
      ) {
        view.campaigns.imageLoaded = target.dataset.workspaceQueueImage;
        const b = target
          .closest("[data-workspace-key]")
          .querySelector('[data-workspace-action="queue-confirm"]');
        if (b) {
          const item = view.campaigns.queue.items[0];
          if (owned(target))
            b.disabled =
              view.busy ||
              hasHold(
                `${actorIdentity()}:queue:${view.campaigns.campaign.campaignId}:${item.itemId}`,
              ) ||
              !queueCanConfirm(item, view.workspace, view.billing, true);
        }
      }
    },
    true,
  );
  document.addEventListener(
    "error",
    (event) => {
      if (
        owned(event.target) &&
        event.target.dataset.workspaceQueueImage &&
        view.campaigns.imageFailed !== event.target.dataset.workspaceQueueImage
      ) {
        view.campaigns.imageFailed = event.target.dataset.workspaceQueueImage;
        view.campaigns.imageLoaded = null;
        view.error =
          "The final attachment could not be displayed. Sending is blocked.";
        changed();
      }
    },
    true,
  );
  return {
    load,
    render,
    reset,
    refresh,
    getMeta: () => ({
      organizationName:
        view.billing?.organizationName || context()?.organizationName,
      capabilities: view.workspace?.capabilities || {},
    }),
  };
}
