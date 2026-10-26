/** Preserve editable drafts and native-dialog focus only within the same actor,
 * workspace, and server revision. Hidden identity and revision fields are never restored. */
export function createCoalitionMissionsInteractions({ onClose }) {
  const surface = (root) => root.querySelector(".polis-missions");
  const editable =
    'input:not([type="hidden"]):not([type="file"]):not([type="submit"]),select,textarea';
  const value = (form, name) =>
    form.querySelector(`input[type="hidden"][name="${name}"]`)?.value || "";
  const key = (form) =>
    JSON.stringify([
      form.dataset.routeForm,
      value(form, "missionId"),
      value(form, "jobId"),
      value(form, "parentJobId"),
      value(form, "templateId"),
      value(form, "templateVersion"),
      value(form, "expectedRevision"),
      value(form, "action"),
    ]);
  const defaults = (field) =>
    field.type === "checkbox" || field.type === "radio"
      ? field.defaultChecked
      : field.tagName === "SELECT"
        ? JSON.stringify(
            [...field.options].map((o) => [o.value, o.defaultSelected]),
          )
        : field.defaultValue;
  const fields = (form) =>
    [...form.querySelectorAll(editable)].map((field, index) => ({
      field,
      id: JSON.stringify([
        field.name || field.id,
        field.type,
        ["checkbox", "radio"].includes(field.type) ? field.value : "",
        index,
      ]),
    }));
  let opener = null;
  function rememberOpener(target) {
    if (
      ![
        "coalition-missions-ui-open",
        "coalition-missions-ui-create",
        "coalition-missions-ui-new-template",
        "coalition-missions-ui-use-template",
        "coalition-missions-ui-edit-template",
      ].includes(target.dataset.action)
    )
      return;
    opener = { action: target.dataset.action, id: target.dataset.id || "" };
  }
  function beforeRender(root) {
    const node = surface(root);
    if (!node) return null;
    const active = document.activeElement;
    return {
      context: node.dataset.missionsContext,
      revision: node.dataset.missionsRevision,
      tabScroll: node.querySelector('[role="tablist"]')?.scrollLeft || 0,
      forms: [...node.querySelectorAll("form[data-route-form]")].map(
        (form) => ({
          key: key(form),
          values: fields(form).map(({ field, id }) => ({
            id,
            initial: defaults(field),
            value: field.value,
            checked: field.checked,
            focused: field === active,
            start: field.selectionStart,
            end: field.selectionEnd,
          })),
        }),
      ),
      focus: active?.id && node.contains(active) ? active.id : null,
      dialogs: [...node.querySelectorAll("dialog[open]")].map((dialog) => ({
        id: dialog.id,
        scroll: dialog.querySelector(".dialog-body")?.scrollTop || 0,
      })),
      disclosures: [...node.querySelectorAll("details")].map(
        (detail, index) => ({ index, open: detail.open }),
      ),
    };
  }
  function afterRender(root, snapshot) {
    const node = surface(root);
    if (!node) return;
    const sameContext = snapshot?.context === node.dataset.missionsContext;
    const same =
      sameContext && snapshot?.revision === node.dataset.missionsRevision;
    const tabs = node.querySelector('[role="tablist"]');
    if (tabs) {
      if (sameContext) tabs.scrollLeft = snapshot.tabScroll || 0;
      const selectedTab = tabs.querySelector('[aria-selected="true"]');
      if (selectedTab) {
        const viewport = tabs.getBoundingClientRect();
        const selectedBounds = selectedTab.getBoundingClientRect();
        if (selectedBounds.left < viewport.left)
          tabs.scrollLeft -= viewport.left - selectedBounds.left;
        else if (selectedBounds.right > viewport.right)
          tabs.scrollLeft += selectedBounds.right - viewport.right;
      }
    }
    let focused = null;
    if (same) {
      for (const form of node.querySelectorAll("form[data-route-form]")) {
        const old = snapshot.forms.find((item) => item.key === key(form));
        if (!old) continue;
        for (const { field, id } of fields(form)) {
          const previous = old.values.find((item) => item.id === id);
          if (!previous || previous.initial !== defaults(field)) continue;
          if (field.type === "checkbox" || field.type === "radio")
            field.checked = previous.checked;
          else if (
            field.tagName !== "SELECT" ||
            [...field.options].some((option) => option.value === previous.value)
          )
            field.value = previous.value;
          if (previous.focused) focused = { field, previous };
        }
      }
      const details = node.querySelectorAll("details");
      for (const disclosure of snapshot.disclosures)
        if (details[disclosure.index])
          details[disclosure.index].open = disclosure.open;
    }
    for (const dialog of node.querySelectorAll(
      "dialog[data-missions-dialog]",
    )) {
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        onClose(dialog.dataset.missionsDialog);
      });
      if (!dialog.open) dialog.showModal();
      const old =
        same && snapshot.dialogs.find((item) => item.id === dialog.id);
      if (old && dialog.querySelector(".dialog-body"))
        dialog.querySelector(".dialog-body").scrollTop = old.scroll;
    }
    const sameIdTarget =
      same && snapshot.focus
        ? node.querySelector(`#${CSS.escape(snapshot.focus)}`)
        : null;
    if (focused) {
      focused.field.focus({ preventScroll: true });
      if (
        typeof focused.previous.start === "number" &&
        [
          "textarea",
          "text",
          "search",
          "email",
          "url",
          "tel",
          "password",
        ].includes(focused.field.type)
      )
        focused.field.setSelectionRange(
          focused.previous.start,
          focused.previous.end,
        );
    } else if (sameIdTarget) {
      sameIdTarget.focus({ preventScroll: true });
    } else if (
      sameContext &&
      snapshot.dialogs.length &&
      !node.querySelector("dialog[open]")
    ) {
      const target =
        opener &&
        [...node.querySelectorAll("[data-action]")].find(
          (el) =>
            el.dataset.action === opener.action &&
            (el.dataset.id || "") === opener.id,
        );
      (
        target || node.querySelector('[role="tab"][aria-selected="true"]')
      )?.focus({ preventScroll: true });
    }
  }
  return { beforeRender, afterRender, rememberOpener };
}

/** Canonicalize old coalition shortcuts so an approved workspace never embeds the old hub. */
export function canonicalCoalitionMissionsPath(
  path,
  origin = "https://polisapp.io",
) {
  let url;
  try {
    url = new URL(path, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  let scopeId = "";
  let missionId = "";
  const decodeSegment = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  };
  const organization = url.pathname.match(
    /^\/workspace\/coalition\/([^/]+)\/(?:work\/)?missions\/?$/u,
  );
  if (organization) scopeId = decodeSegment(organization[1]);
  else if (
    /^\/missions\/?$/u.test(url.pathname) &&
    url.searchParams.get("scopeType") === "coalition"
  )
    scopeId = url.searchParams.get("scopeId") || "";
  else {
    const detail = url.pathname.match(/^\/missions\/([^/]+)\/?$/u);
    if (!detail) return null;
    let back;
    try {
      back = new URL(url.searchParams.get("returnTo") || "", origin);
    } catch {
      return null;
    }
    if (back.origin !== origin) return null;
    const coalition = back.pathname.match(
      /^\/coalitions\/([^/]+)\/missions\/?$/u,
    );
    if (!coalition) return null;
    scopeId = decodeSegment(coalition[1]);
    missionId = decodeSegment(detail[1]);
    if (missionId === null) return null;
  }
  if (!scopeId) return null;
  const params = new URLSearchParams();
  const views = {
    admin: "missions",
    mine: "mine",
    attention: "attention",
    board: "missions",
    audit: "activity",
    people: "people",
    templates: "templates",
    timeline: "timeline",
  };
  const requested = url.searchParams.get("view");
  if (requested && views[requested])
    params.set("missionView", views[requested]);
  if (requested === "board") params.set("missionLayout", "board");
  if (url.searchParams.get("q"))
    params.set("missionQuery", url.searchParams.get("q"));
  if (url.searchParams.get("status"))
    params.set("missionStatus", url.searchParams.get("status"));
  if (missionId) params.set("missionId", missionId);
  return `/coalitions/${encodeURIComponent(scopeId)}/missions${params.size ? `?${params}` : ""}`;
}
