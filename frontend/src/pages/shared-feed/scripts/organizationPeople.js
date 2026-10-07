import { createOrganizationPersonSearch } from "./organizationPersonSearch";
import { createOrganizationContactBook } from "./organizationContactBook";
import { createOrganizationContactsApi } from "./organizationContactsApi";
import { loadContactCities } from "./organizationContactCities";
import {
  escapeText as e,
  button,
  head,
  notice,
  field,
  id,
  list,
} from "./textingWorkspaceUi";

/** Independent organization People, Contacts, Audiences and role-default review. */
export function createOrganizationPeoplePage({
  request,
  context,
  changed,
  navigate,
  confirm,
  beginContactCampaign,
}) {
  let view = {},
    sequence = 0,
    contacts = null,
    timer;
  const identity = () => {
    const c = context();
    return c?.userId && c?.scopeId && c?.scopeType
      ? `${c.userId}:${c.scopeType}:${c.scopeId}:${c.section}`
      : "";
  };
  const search = createOrganizationPersonSearch({ request, identity, changed });
  const current = () => view.key && view.key === identity();
  const base = () =>
    `/api/organizations/${id(context().scopeType)}/${id(context().scopeId)}/audience-groups`;
  const route = (suffix) =>
    `/workspace/${id(context().scopeType)}/${id(context().scopeId)}/${suffix}`;
  const roleBase = () =>
    context().scopeType === "candidate"
      ? `/api/candidateDashboard/${id(context().scopeId)}/staff/access/roles`
      : `/api/coalitions/${id(context().scopeId)}/access/roles`;
  const catalogPath = () =>
    context().scopeType === "candidate"
      ? roleBase()
      : roleBase().replace("/access/roles", "/access/catalog");
  const rolesRoute = () =>
    context().scopeType === "candidate"
      ? `/candidate-dashboard/${id(context().scopeId)}/staff`
      : `/coalitions/${id(context().scopeId)}/members`;
  const b = (action, text, value = "", disabled = false) =>
    button(action, text, { value, disabled: view.busy || disabled });
  const guard = (key = view.key, version = sequence) => {
    if (!current() || key !== view.key || version !== sequence)
      throw new Error("Organization or account changed. Reopen this page.");
  };
  function reset() {
    sequence++;
    clearTimeout(timer);
    contacts?.dispose?.();
    contacts = null;
    search.reset();
    view = {};
  }
  async function call(path, options = {}) {
    const key = view.key,
      version = sequence;
    guard(key, version);
    const result = await request(path, {
      auth: true,
      ...options,
      beforeRequest: () => guard(key, version),
    });
    guard(key, version);
    return result;
  }
  function contactRuntime(key, version) {
    const check = () => guard(key, version);
    return {
      contactApi: createOrganizationContactsApi({
        request,
        scopeKey: `${context().scopeType}:${context().scopeId}`,
        guard: check,
      }),
      guard: check,
      view: () => view,
      context,
      busy: () => view.busy === true,
      changed: () => {
        check();
        changed();
      },
      fail: (error) => {
        check();
        view.error = error?.message || "Unable to save this change.";
      },
      toast: (message) => {
        check();
        view.message = message;
      },
      cities: async (state, options) => {
        check();
        const result = await loadContactCities(state, request, options);
        check();
        return result;
      },
      beginContactCampaign: (selection) => {
        check();
        if (!beginContactCampaign)
          throw new Error(
            "Campaign selection is unavailable. Reopen Contacts.",
          );
        beginContactCampaign({
          scopeKey: `${context().scopeType}:${context().scopeId}`,
          actorUserId: context().userId,
          selection,
        });
      },
    };
  }
  async function load({ force = false } = {}) {
    const key = identity();
    if (!key) {
      reset();
      return;
    }
    if (current() && (view.loading || (view.loaded && !force))) return;
    const savedUndo = current() ? view.undo : {};
    reset();
    view = {
      key,
      loading: true,
      undo: savedUndo || {},
      groups: [],
      members: [],
    };
    const version = sequence;
    changed();
    try {
      switch (context().section) {
        case "contacts":
          contacts = createOrganizationContactBook(
            contactRuntime(key, version),
          );
          await contacts.load();
          break;
        case "audiences":
          view.groups = list((await call(base())).groups);
          break;
        case "roles": {
          const result = await call(catalogPath());
          view.catalog = result.catalog;
          view.revision = result.revision;
          view.canManage =
            result.canManage === true && result.catalog?.authoritative === true;
          break;
        }
        default:
          // Contacts capability is independent from texting registration and member management.
          view.contactSchema = await call(
            `/api/contact-book/scopes/${id(`${context().scopeType}:${context().scopeId}`)}/schema`,
          ).catch(() => null);
      }
      guard(key, version);
      view.loaded = true;
    } catch (error) {
      if (current() && version === sequence)
        view.error =
          error?.message || "This organization page could not be loaded.";
    } finally {
      if (current() && version === sequence) {
        view.loading = false;
        changed();
      }
    }
  }
  async function run(action) {
    if (!current() || view.busy) return;
    const key = view.key,
      version = sequence;
    view.busy = true;
    view.error = "";
    view.message = "";
    changed();
    try {
      await action();
    } catch (error) {
      if (current() && version === sequence)
        view.error = error?.message || "Unable to save. Refresh and try again.";
    } finally {
      if (current() && version === sequence && key === view.key) {
        view.busy = false;
        changed();
      }
    }
  }
  async function loadGroup(groupId, more = false) {
    const query = more && view.cursor ? `?cursor=${id(view.cursor)}` : "";
    const result = await call(`${base()}/${id(groupId)}${query}`);
    view.group = result.group;
    const members = more ? view.members : [];
    view.members = [
      ...new Map(
        [...members, ...list(result.members)].map((p) => [p.userId, p]),
      ).values(),
    ];
    view.cursor = result.nextCursor;
    view.editor = null;
    if (!more) search.reset();
  }
  const permissionNames = (keys) =>
    list(keys)
      .map(
        (key) =>
          view.catalog?.permissions?.find((p) => p.key === key)?.label || key,
      )
      .join(", ") || "None";
  function renderRoles() {
    return `${head("People", "Review role defaults", "Apply reviewed defaults for future assignments. Existing members, custom roles and individual overrides keep their access.")}
      ${b("edit-roles", "Edit organization roles or create a custom role")}
      ${list(view.catalog?.roles)
        .filter((role) => role.presetUpdate)
        .map((role) => {
          const p = role.presetUpdate;
          return `<details class="pt-card"><summary>${e(role.label)} · ${e(role.presetVersion || p.currentVersion)}</summary>
          <p>${e(p.reason)}</p><p>Current: ${e(permissionNames(role.defaultPermissions))}</p>
          <p>Proposed: ${e(permissionNames(p.permissions))}</p>
          ${p.customized ? `<p>Organization edits are preserved. Optional recommendations: ${e(permissionNames(p.recommendedPermissions))}. Choose additions in Edit organization roles.</p>` : ""}
          ${list(p.sensitivePermissions).length ? `<p>Review existing sensitive grants: ${e(permissionNames(p.sensitivePermissions))}</p>` : ""}
          ${b("preset-apply", "Apply reviewed defaults", role.roleKey, !view.canManage)}
          ${view.undo[role.roleKey] ? b("preset-undo", "Undo default change", role.roleKey, !view.canManage) : ""}
        </details>`;
        })
        .join("")}`;
  }
  function renderAudience() {
    const group = view.group;
    if (view.editor)
      return `${head("People", group ? "Edit audience" : "New audience")}
      <form data-org-people-form="audience">${field("name", "Audience name", view.editor.name, { required: true, max: 100 })}
      ${field("description", "Description", view.editor.description || "", { max: 500 })}
      <button class="pt-btn" type="submit"${view.busy ? " disabled" : ""}>Save audience</button>${b("editor-cancel", "Cancel")}</form>`;
    if (!group)
      return `${head("People", "Organization audiences", "Choose named groups of people for organization posts.")}${b("audience-new", "New audience")}
      ${list(view.groups).length ? view.groups.map((g) => `<article class="pt-card"><h2>${e(g.name)}</h2><p>${e(g.description || "")}</p><p>${e(g.memberCount || 0)} people</p>${b("audience-open", "Manage people", g.groupId)}</article>`).join("") : notice("No audiences yet", "Create an audience to choose its members.")}`;
    const s = search.state;
    return `${head("People", group.name, group.description || "")}${b("audience-back", "All audiences")}${b("audience-edit", "Edit audience")}${b("audience-delete", "Delete audience")}
      <form data-org-people-form="search">${field("query", "Name or @username", s.query, { extra: "data-org-person-query" })}
      <button class="pt-btn" type="submit"${s.loading ? " disabled" : ""}>Search people</button></form>
      ${s.error ? notice("Search unavailable", s.error) : ""}${s.loading ? notice("Searching people") : ""}
      ${s.people
        .map(
          (p) =>
            `<article class="pt-card"><strong>${e(p.displayName)}</strong>${p.username ? `<span> @${e(p.username)}</span>` : ""}${b(
              "audience-add",
              view.members.some((m) => m.userId === p.userId)
                ? "Already selected"
                : "Add person",
              p.userId,
              view.members.some((m) => m.userId === p.userId),
            )}</article>`,
        )
        .join("")}
      ${s.nextCursor ? b("person-more", "More people") : ""}
      <h2>Audience members</h2>${view.members.length ? view.members.map((p) => `<article class="pt-card"><strong>${e(p.displayName || "Account unavailable")}</strong>${p.username ? `<span> @${e(p.username)}</span>` : ""}${b("audience-remove", "Remove person", p.userId)}</article>`).join("") : notice("No members yet", "Search for people to add to this audience.")}
      ${view.cursor ? b("audience-more", "More members") : ""}`;
  }
  function render() {
    if (!current()) return "";
    let content;
    if (view.loading) content = notice("Loading organization");
    else if (context().section === "contacts")
      content = contacts?.render() || "";
    else if (context().section === "audiences") content = renderAudience();
    else if (context().section === "roles") content = renderRoles();
    else
      content = `${head("Organization", "People", "Manage people, role defaults, audiences and contact records.")}
      ${b("members", context().scopeType === "candidate" ? "Campaign staff" : "Coalition members")}
      ${view.contactSchema?.capabilities?.read ? b("contacts", "Organization contacts") : notice("Contact access", "Contact Book access is separate from member management. Ask an administrator if you need access.")}
      ${b("roles", "Review role defaults")}${b("audiences", "Organization audiences")}`;
    return `<section class="texting-workspace pt-workspace" data-org-people-key="${e(view.key)}" aria-busy="${view.busy ? "true" : "false"}">${view.error ? notice("Needs attention", view.error) + b("reload", "Refresh") : ""}${view.message ? notice(view.message) : ""}${content}</section>`;
  }
  async function action(name, value) {
    if (name === "members" || name === "edit-roles") {
      navigate(rolesRoute());
      return;
    }
    const destinations = {
      contacts: "people/contacts",
      roles: "more/roles",
      audiences: "more/audiences",
    };
    if (destinations[name]) {
      navigate(route(destinations[name]));
      return;
    }
    if (name === "reload") {
      await load({ force: true });
      return;
    }
    if (name === "audience-new") {
      view.group = null;
      view.editor = { name: "", description: "" };
      return;
    }
    if (name === "audience-edit") {
      view.editor = { ...view.group };
      return;
    }
    if (name === "editor-cancel") {
      view.editor = null;
      return;
    }
    if (name === "audience-open" || name === "audience-more") {
      await loadGroup(value || view.group.groupId, name === "audience-more");
      return;
    }
    if (name === "audience-back") {
      view.group = null;
      view.groups = list((await call(base())).groups);
      search.reset();
      return;
    }
    if (name === "person-more") {
      await search.search(search.state.query, { more: true });
      return;
    }
    if (name === "audience-add" || name === "audience-remove") {
      if (
        name === "audience-add" &&
        !search.state.people.some((p) => p.userId === value)
      )
        return;
      if (
        name === "audience-remove" &&
        !(await confirm({
          title: "Remove audience member?",
          message: "This person will no longer belong to this audience.",
          confirmLabel: "Remove",
        }))
      )
        return;
      await call(`${base()}/${id(view.group.groupId)}/members/${id(value)}`, {
        method: name === "audience-add" ? "PUT" : "DELETE",
      });
      await loadGroup(view.group.groupId);
      return;
    }
    if (name === "audience-delete") {
      if (
        !(await confirm({
          title: "Delete audience?",
          message:
            "Drafts using this audience will need another audience before publication.",
          confirmLabel: "Delete",
        }))
      )
        return;
      await call(`${base()}/${id(view.group.groupId)}`, { method: "DELETE" });
      view.group = null;
      view.groups = list((await call(base())).groups);
      return;
    }
    if (name === "preset-apply" || name === "preset-undo") {
      const role = view.catalog?.roles?.find((r) => r.roleKey === value);
      if (!view.canManage || !role?.presetUpdate) return;
      const before = [...role.defaultPermissions];
      const after =
        name === "preset-undo"
          ? view.undo[value]
          : role.presetUpdate.permissions;
      if (
        !after ||
        !(await confirm({
          title:
            name === "preset-undo"
              ? "Restore previous defaults?"
              : `Apply ${role.label} defaults?`,
          message:
            "Only future assignment defaults change. Existing members, custom roles and individual overrides keep their access.",
          confirmLabel: "Apply reviewed defaults",
        }))
      )
        return;
      await call(`${roleBase()}/${id(value)}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: {
          expectedRevision: view.revision,
          defaultPermissions: after,
          expectedPresetPermissions: before,
          adoptPresetVersion: role.presetUpdate.version,
          reason:
            name === "preset-undo"
              ? "preset_defaults_restored"
              : "preset_defaults_reviewed",
        },
      });
      if (name === "preset-undo") delete view.undo[value];
      else view.undo[value] = before;
      const result = await call(catalogPath());
      view.catalog = result.catalog;
      view.revision = result.revision;
      view.canManage =
        result.canManage === true && result.catalog?.authoritative === true;
      view.message =
        "Role defaults saved. Existing assignments were preserved.";
      return;
    }
    if (contacts?.localAction?.(name, value)) return;
    await contacts?.action?.(name, value);
  }
  const owned = (target) =>
    current() &&
    target?.closest?.("[data-org-people-key]")?.dataset.orgPeopleKey ===
      view.key;
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-workspace-action]");
    if (!owned(target) || target.disabled) return;
    event.preventDefault();
    if (
      contacts?.localAction?.(
        target.dataset.workspaceAction,
        target.dataset.value,
        target,
      )
    ) {
      changed();
      return;
    }
    void run(() =>
      action(target.dataset.workspaceAction, target.dataset.value),
    );
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!owned(form)) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form),
      type = form.dataset.orgPeopleForm;
    if (type === "search") {
      clearTimeout(timer);
      void search.search(data.get("query"));
      return;
    }
    // Capture form data and native file before the busy render replaces the form.
    if (form.dataset.workspaceForm?.endsWith("-import-preview")) {
      const input = form.querySelector('input[type="file"]');
      if (input?.files?.length) contacts?.change(input);
    }
    void run(async () => {
      if (type === "audience") {
        await call(
          view.group ? `${base()}/${id(view.group.groupId)}` : base(),
          {
            method: view.group ? "PATCH" : "POST",
            body: {
              name: data.get("name"),
              description: data.get("description"),
            },
          },
        );
        view.editor = null;
        if (view.group) await loadGroup(view.group.groupId);
        else view.groups = list((await call(base())).groups);
      } else await contacts?.submit?.(form.dataset.workspaceForm, form);
    });
  });
  const change = (event) => {
    const target = event.target;
    if (!owned(target)) return;
    if (target.hasAttribute?.("data-org-person-query")) {
      clearTimeout(timer);
      const query = target.value;
      // Reset immediately so a completed older request cannot repopulate results.
      search.reset();
      search.state.query = query;
      timer = setTimeout(() => {
        if (owned(target)) void search.search(query);
      }, 300);
      return;
    }
    if (view.editor && ["name", "description"].includes(target.name))
      view.editor[target.name] = target.value;
    if (contacts?.change?.(target)) changed();
    if (
      ["-tag-cell", "-page-size"].some((suffix) =>
        target.dataset.contactChange?.endsWith(suffix),
      )
    )
      void run(() => contacts.action(target.dataset.contactChange));
  };
  document.addEventListener("input", change);
  document.addEventListener("change", change);
  document.addEventListener("keydown", (event) => {
    const dialog = document.querySelector("[data-contact-dialog]");
    if (!dialog || !owned(dialog)) return;
    if (event.key === "Escape" && !view.busy) {
      event.preventDefault();
      if (
        contacts?.localAction?.(`${dialog.dataset.contactDialog}-overlay-close`)
      )
        changed();
      return;
    }
    if (event.key !== "Tab") return;
    const fields = [
      ...dialog.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
      ),
    ].filter(
      (element) => element.getClientRects().length && element.tabIndex >= 0,
    );
    const first = fields[0],
      last = fields.at(-1),
      active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (
      event.shiftKey &&
      (active === first || !dialog.contains(active))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !dialog.contains(active))
    ) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener(
    "toggle",
    (event) => {
      if (owned(event.target)) contacts?.change?.(event.target);
    },
    true,
  );
  return {
    load,
    render,
    reset,
    action: (name, value) => run(() => action(name, value)),
    search,
  };
}
