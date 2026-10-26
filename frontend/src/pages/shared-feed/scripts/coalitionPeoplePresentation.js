const PEOPLE_TABS = ["members", "requests", "invitations", "roles"];
const EDITABLE_FIELDS =
  "input:not([type='hidden']):not([type='file']):not([type='submit']):not([type='button']):not([type='reset']), select, textarea";

function peopleSurface(root) {
  return root?.matches?.(".coalition-people")
    ? root
    : root?.querySelector?.(".coalition-people") || null;
}

function hiddenValue(form, name) {
  return (
    Array.from(form.elements).find(
      (field) => field.type === "hidden" && field.name === name,
    )?.value || ""
  );
}

/** Stable identities keep drafts with their member or role when rows are sorted. */
function peopleForms(surface) {
  const occurrences = new Map();
  return Array.from(surface.querySelectorAll("form[data-route-form]")).map(
    (form) => {
      const identity = JSON.stringify([
        form.dataset.routeForm,
        hiddenValue(form, "userId"),
        hiddenValue(form, "roleKey"),
      ]);
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      return {
        form,
        key: `${identity}:${occurrence}`,
        revision: JSON.stringify([
          surface.dataset.peopleRevision || "",
          hiddenValue(form, "expectedRevision"),
          hiddenValue(form, "expectedAccess"),
        ]),
      };
    },
  );
}

function formFields(form) {
  const occurrences = new Map();
  return Array.from(form.querySelectorAll(EDITABLE_FIELDS))
    .filter((field) => field.name)
    .map((field) => {
      const identity = JSON.stringify([
        field.tagName,
        field.name,
        field.type || "",
        ["checkbox", "radio"].includes(field.type) ? field.value : "",
      ]);
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      return { field, key: `${identity}:${occurrence}` };
    });
}

function fieldDefault(field) {
  if (["checkbox", "radio"].includes(field.type)) return field.defaultChecked;
  if (field.tagName === "SELECT") {
    return JSON.stringify(
      Array.from(field.options).map((option) => [
        option.value,
        option.defaultSelected,
      ]),
    );
  }
  return field.defaultValue;
}

function captureField({ field, key }) {
  return {
    key,
    renderedDefault: fieldDefault(field),
    value:
      field.tagName === "SELECT" && field.multiple
        ? Array.from(field.selectedOptions).map((option) => option.value)
        : field.value,
    checked: field.checked,
    start: field.selectionStart,
    end: field.selectionEnd,
  };
}

function restoreField(field, snapshot) {
  if (fieldDefault(field) !== snapshot.renderedDefault) return;
  if (["checkbox", "radio"].includes(field.type)) {
    field.checked = snapshot.checked;
  } else if (field.tagName === "SELECT") {
    const values = Array.isArray(snapshot.value)
      ? snapshot.value
      : [snapshot.value];
    if (
      !values.every((value) =>
        Array.from(field.options).some((option) => option.value === value),
      )
    )
      return;
    if (field.multiple) {
      Array.from(field.options).forEach((option) => {
        option.selected = values.includes(option.value);
      });
    } else field.value = snapshot.value;
  } else field.value = snapshot.value;
}

function elementKey(scope, element) {
  const attribute = [
    "id",
    "data-people-tab",
    "data-coalition-member-filter",
    "name",
    "data-action",
  ].find((name) => element.getAttribute(name));
  const value = attribute ? element.getAttribute(attribute) : "";
  const qualifier = ["checkbox", "radio"].includes(element.type)
    ? element.value
    : null;
  const matches = Array.from(
    scope.querySelectorAll(element.tagName.toLowerCase()),
  ).filter(
    (candidate) =>
      (!attribute || candidate.getAttribute(attribute) === value) &&
      (qualifier === null || candidate.value === qualifier),
  );
  return {
    tag: element.tagName.toLowerCase(),
    attribute,
    value,
    qualifier,
    index: matches.indexOf(element),
  };
}

function findElement(scope, key) {
  if (!scope || !key) return null;
  return (
    Array.from(scope.querySelectorAll(key.tag)).filter(
      (candidate) =>
        (!key.attribute ||
          candidate.getAttribute(key.attribute) === key.value) &&
        (key.qualifier === null || candidate.value === key.qualifier),
    )[key.index] || null
  );
}

function captureFocus(
  surface,
  forms,
  element = surface.ownerDocument.activeElement,
) {
  if (!element || !surface.contains(element)) return null;
  const owner = forms.find(({ form }) => form.contains(element));
  const disclosure = owner ? null : element.closest("[data-people-disclosure]");
  const scope = owner?.form || disclosure || surface;
  return {
    form: owner?.key || null,
    disclosure: disclosure?.dataset.peopleDisclosure || null,
    element: elementKey(scope, element),
    start: element.selectionStart,
    end: element.selectionEnd,
  };
}

function restoreFocus(surface, forms, snapshot) {
  if (!snapshot) return false;
  const scope = snapshot.form
    ? forms.find(({ key }) => key === snapshot.form)?.form
    : snapshot.disclosure
      ? Array.from(surface.querySelectorAll("[data-people-disclosure]")).find(
          (element) => element.dataset.peopleDisclosure === snapshot.disclosure,
        )
      : surface;
  const element = findElement(scope, snapshot.element);
  if (!element || element.disabled || !element.getClientRects().length)
    return false;
  element.focus({ preventScroll: true });
  if (
    snapshot.start !== null &&
    snapshot.start !== undefined &&
    ["text", "password", "search", "tel", "url"].includes(element.type)
  ) {
    element.setSelectionRange(snapshot.start, snapshot.end);
  }
  return true;
}

/** Presentation state is scoped to the current actor and coalition, never access rights. */
export function createCoalitionPeopleInteractions() {
  let context = "";
  let activeTab = "members";
  let inviteOpen = false;
  let inviteOpener = null;
  const boundSurfaces = new WeakSet();

  function syncContext(surface) {
    const next = surface?.dataset.peopleContext || "";
    if (!next || next !== context) {
      context = next;
      activeTab = "members";
      inviteOpen = false;
      inviteOpener = null;
    }
    return next;
  }

  function selectTab(surface, requested, focus = false) {
    const tabs = Array.from(
      surface.querySelectorAll("[data-people-tab]"),
    ).filter(
      (tab) => PEOPLE_TABS.includes(tab.dataset.peopleTab) && !tab.disabled,
    );
    activeTab = tabs.some((tab) => tab.dataset.peopleTab === requested)
      ? requested
      : tabs.find((tab) => tab.dataset.peopleTab === "members")?.dataset
          .peopleTab ||
        tabs[0]?.dataset.peopleTab ||
        "members";
    surface.querySelectorAll("[data-people-tab]").forEach((tab) => {
      const selected = tab.dataset.peopleTab === activeTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle("is-active", selected);
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    surface.querySelectorAll("[data-people-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.peoplePanel !== activeTab;
    });
  }

  function openInvite(surface, restore = false) {
    const dialog = surface.querySelector("[data-people-invite-dialog]");
    if (!dialog || typeof dialog.showModal !== "function") return false;
    inviteOpen = true;
    if (!dialog.open) dialog.showModal();
    if (!restore) {
      dialog
        .querySelector(
          "[data-coalition-invite-search-input]:not(:disabled), input:not([type='hidden']):not(:disabled)",
        )
        ?.focus({ preventScroll: true });
    }
    return true;
  }

  function closeInvite(surface) {
    inviteOpen = false;
    const dialog = surface.querySelector("[data-people-invite-dialog]");
    if (dialog?.open) dialog.close();
    restoreFocus(surface, peopleForms(surface), inviteOpener);
  }

  function bindSurface(surface) {
    if (boundSurfaces.has(surface)) return;
    boundSurfaces.add(surface);
    const key = context;
    const current = () => surface.isConnected && context === key;
    surface.addEventListener("keydown", (event) => {
      const tab = event.target.closest("[data-people-tab]");
      if (
        !current() ||
        !tab ||
        !surface.contains(tab) ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      const tabs = Array.from(
        surface.querySelectorAll("[data-people-tab]"),
      ).filter(
        (item) =>
          !item.disabled && PEOPLE_TABS.includes(item.dataset.peopleTab),
      );
      const index = tabs.indexOf(tab);
      if (index < 0 || !tabs.length) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      selectTab(surface, tabs[next].dataset.peopleTab, true);
    });
    surface.addEventListener(
      "cancel",
      (event) => {
        if (current() && event.target.matches("[data-people-invite-dialog]"))
          inviteOpen = false;
      },
      true,
    );
    surface.addEventListener(
      "close",
      (event) => {
        if (!current() || !event.target.matches("[data-people-invite-dialog]"))
          return;
        inviteOpen = false;
        restoreFocus(surface, peopleForms(surface), inviteOpener);
      },
      true,
    );
  }

  return {
    beforeRender(root) {
      const surface = peopleSurface(root);
      if (!surface) return null;
      const key = syncContext(surface);
      const forms = peopleForms(surface);
      inviteOpen = Boolean(
        surface.querySelector("[data-people-invite-dialog]")?.open,
      );
      return {
        context: key,
        tab: activeTab,
        inviteOpen,
        disclosures: Array.from(
          surface.querySelectorAll("[data-people-disclosure]"),
        ).map((element) => [element.dataset.peopleDisclosure, element.open]),
        forms: forms.map(({ form, key: formKey, revision }) => ({
          key: formKey,
          revision,
          fields: formFields(form).map(captureField),
        })),
        focus: captureFocus(surface, forms),
      };
    },
    afterRender(root, snapshot) {
      const surface = peopleSurface(root);
      if (!surface) {
        syncContext(null);
        return;
      }
      const key = syncContext(surface);
      const sameContext = Boolean(key) && snapshot?.context === key;
      const forms = peopleForms(surface);
      if (sameContext) {
        activeTab = snapshot.tab;
        inviteOpen = snapshot.inviteOpen;
        const disclosures = new Map(snapshot.disclosures);
        surface
          .querySelectorAll("[data-people-disclosure]")
          .forEach((element) => {
            if (disclosures.has(element.dataset.peopleDisclosure))
              element.open = disclosures.get(element.dataset.peopleDisclosure);
          });
        for (const { form, key: formKey, revision } of forms) {
          const previous = snapshot.forms.find(
            (entry) => entry.key === formKey && entry.revision === revision,
          );
          if (!previous) continue;
          const fields = new Map(
            previous.fields.map((entry) => [entry.key, entry]),
          );
          formFields(form).forEach(({ field, key: fieldKey }) => {
            if (fields.has(fieldKey)) restoreField(field, fields.get(fieldKey));
          });
        }
      }
      selectTab(surface, activeTab);
      bindSurface(surface);
      if (inviteOpen) openInvite(surface, true);
      if (sameContext) restoreFocus(surface, forms, snapshot.focus);
    },
    handleAction(action, target, root) {
      if (
        ![
          "coalition-people-tab",
          "coalition-people-invite",
          "coalition-people-invite-close",
        ].includes(action)
      )
        return false;
      const surface = peopleSurface(root);
      if (!surface?.contains(target) || target.disabled) return false;
      syncContext(surface);
      if (action === "coalition-people-tab")
        selectTab(surface, target.dataset.peopleTab, true);
      else if (action === "coalition-people-invite") {
        inviteOpener = captureFocus(surface, peopleForms(surface), target);
        openInvite(surface);
      } else closeInvite(surface);
      return true;
    },
  };
}
