import "../css/person-selection.css";
import { createOrganizationPersonSearch } from "./organizationPersonSearch";
import { escapeText as e } from "./textingWorkspaceUi";

const labels = new Map();
export function renderOrganizationPersonField(
  name,
  label = "Choose a person",
  { value = "", disabled = false, extra = "" } = {},
) {
  return `<div class="shared-person-field" data-person-field><span>${e(label)}</span>
    <input type="hidden" name="${e(name)}" value="${e(value)}" ${extra} />
    <button class="shared-feed-chip" type="button" data-person-choose${disabled ? " disabled" : ""}>${e(labels.get(value) || (value ? "Change selected person" : label))}</button></div>`;
}

/** Progressive, accessible person picker for existing form payloads. */
export function installOrganizationPersonFields({ request, identity }) {
  const hydrated = new WeakSet();
  const hydrate = (node) => {
    const fields = [
      ...(node.matches?.("[data-person-field]") ? [node] : []),
      ...(node.querySelectorAll?.("[data-person-field]") || []),
    ];
    for (const field of fields) {
      const input = field.querySelector('input[type="hidden"]');
      const trigger = field.querySelector("[data-person-choose]");
      if (!input?.value || !trigger || hydrated.has(field)) continue;
      hydrated.add(field);
      const actor = identity(),
        value = input.value;
      if (labels.has(value)) {
        trigger.textContent = labels.get(value);
        continue;
      }
      trigger.textContent = "Loading selected person";
      void request(`/api/users/${encodeURIComponent(value)}/profile`, {
        auth: true,
      })
        .then((payload) => {
          if (
            !field.isConnected ||
            actor !== identity() ||
            input.value !== value
          )
            return;
          const person = payload.profile || payload;
          const name = person.displayName || person.username || "Polis member";
          const label = person.username
            ? `${name} (@${person.username})`
            : name;
          labels.set(value, label);
          trigger.textContent = label;
        })
        .catch(() => {
          if (
            field.isConnected &&
            actor === identity() &&
            input.value === value
          )
            trigger.textContent = "Account unavailable - choose a replacement";
        });
    }
  };
  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.addedNodes) hydrate(node);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    hydrate(document);
  }
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-person-choose]");
    if (!trigger || trigger.disabled) return;
    const field = trigger.closest("[data-person-field]"),
      input = field?.querySelector('input[type="hidden"]');
    if (!input) return;
    event.preventDefault();
    const actor = identity();
    const dialog = document.createElement("dialog");
    dialog.className = "shared-person-dialog";
    dialog.setAttribute("aria-label", "Choose a person");
    dialog.innerHTML = `<h2>Choose a person</h2><label>Name or @username<input type="search" data-person-query autocomplete="off" /></label>
      <div data-person-results aria-live="polite">Enter at least two characters.</div><button class="shared-feed-chip" type="button" data-person-cancel>Cancel</button>`;
    document.body.append(dialog);
    const query = dialog.querySelector("[data-person-query]");
    const results = dialog.querySelector("[data-person-results]");
    let timer;
    const active = () => actor === identity() && field.isConnected;
    const search = createOrganizationPersonSearch({
      request,
      identity,
      changed: () => {
        if (!active()) {
          close();
          return;
        }
        const s = search.state;
        results.innerHTML = `${s.error ? `<p>${e(s.error)}</p>` : ""}${s.loading ? "<p>Searching people...</p>" : ""}
        ${s.people.map((person, index) => `<button class="shared-feed-chip" type="button" data-person-result="${index}">${e(person.displayName)}${person.username ? ` (@${e(person.username)})` : ""}</button>`).join("")}
        ${!s.loading && !s.people.length ? "<p>No matching people found.</p>" : ""}
        ${s.nextCursor ? '<button class="shared-feed-chip" type="button" data-person-more>More people</button>' : ""}`;
      },
    });
    const close = () => {
      clearTimeout(timer);
      search.reset();
      dialog.close();
      dialog.remove();
      trigger.focus();
    };
    query.addEventListener("input", () => {
      clearTimeout(timer);
      search.reset();
      const value = query.value;
      timer = setTimeout(() => {
        if (active()) void search.search(value);
        else close();
      }, 300);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-person-cancel]")) {
        close();
        return;
      }
      if (event.target.closest("[data-person-more]")) {
        void search.search(query.value, { more: true });
        return;
      }
      const target = event.target.closest("[data-person-result]");
      if (!target || !active()) return;
      const person = search.state.people[Number(target.dataset.personResult)];
      if (!person) return;
      const label = person.username
        ? `${person.displayName} (@${person.username})`
        : person.displayName;
      labels.set(person.userId, label);
      input.value = person.userId;
      trigger.textContent = label;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
    });
    dialog.showModal();
    query.focus();
  });
}
