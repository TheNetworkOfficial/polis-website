const sections = new Set([
  "home",
  "registration",
  "settings",
  "contacts",
  "campaigns",
  "team",
  "send",
  "inbox",
  "conversation",
  "results",
  "balance",
]);

export const escapeTextingHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

/** Existing payment return URLs remain stable; other views share one scoped route. */
export function textingRoute(
  organizationId,
  section = "home",
  resourceId = "",
) {
  const organization = encodeURIComponent(organizationId);
  const selected = section === "overview" ? "home" : section;
  if (selected === "balance")
    return `/organizations/${organization}/texting-balance`;
  if (!sections.has(selected)) throw new Error("Unknown texting view.");
  const base = `/organizations/${organization}/texting`;
  return `${base}${selected === "home" ? "" : `/${selected}`}${resourceId ? `/${encodeURIComponent(resourceId)}` : ""}`;
}

export function parseTextingRoute(path) {
  const match =
    /^\/organizations\/([^/]+)\/(texting-balance|texting)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/u.exec(
      path,
    );
  if (!match || (match[2] === "texting-balance" && (match[3] || match[4])))
    return null;
  const section =
    match[2] === "texting-balance" ? "balance" : match[3] || "home";
  if (!sections.has(section)) return null;
  try {
    const organizationId = decodeURIComponent(match[1]);
    const resourceId = match[4] ? decodeURIComponent(match[4]) : "";
    if (
      !organizationId ||
      [...(organizationId + resourceId)].some(
        (character) => character.charCodeAt(0) < 32,
      )
    )
      return null;
    return { organizationId, section, resourceId };
  } catch {
    return null;
  }
}

export function textingIcon(name) {
  const paths = {
    home: "m3 10 9-7 9 7v10H3zm6 10v-7h6v7",
    campaigns: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
    contacts:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m4 10v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    inbox: "M3 5h18v14H3zm0 0 9 8 9-8",
    balance: "M3 5h17v15H3zM3 5V3h14m-2 8h7v5h-7zm3 2v1",
    settings:
      "M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    back: "M19 12H5m6-6-6 6 6 6",
  };
  return `<svg class="pt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.home}"/></svg>`;
}

const link = (route, text, extra = "") =>
  `<a href="${escapeTextingHtml(route)}" data-action="navigate" data-route="${escapeTextingHtml(route)}" ${extra}>${text}</a>`;

export function renderTextingShell({
  organizationId,
  organizationName,
  section,
  userName,
  logoUrl,
  content,
  manageBilling = false,
}) {
  const setup = section === "registration";
  const active =
    {
      send: "campaigns",
      team: "campaigns",
      results: "campaigns",
      conversation: "inbox",
    }[section] || section;
  const navigation = (
    setup
      ? ["home", "settings"]
      : ["home", "campaigns", "contacts", "inbox", "balance", "settings"]
  )
    .filter((key) => key !== "balance" || manageBilling === true)
    .map((key) =>
      link(
        textingRoute(organizationId, key),
        `${textingIcon(key)}<span>${key[0].toUpperCase() + key.slice(1)}</span>`,
        `class="pt-nav-item${active === key ? " is-active" : ""}" ${active === key ? 'aria-current="page"' : ""}`,
      ),
    )
    .join("");
  const initials = String(userName || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return `<section class="texting-workspace" aria-label="Organization texting">
    <a class="pt-skip-link" href="#texting-content">Skip to texting content</a>
    <header class="pt-topbar">
      ${link("/feed", `<img src="${escapeTextingHtml(logoUrl)}" alt="" width="48" height="48"><span>Polis</span>`, 'class="pt-brand" aria-label="Polis home"')}
      ${link(`/coalitions/${encodeURIComponent(organizationId)}`, escapeTextingHtml(organizationName || "Texting workspace"), 'class="pt-organization"')}
      ${link("/profile", `<span>${escapeTextingHtml(userName || "Your account")}</span><b class="pt-avatar" aria-hidden="true">${escapeTextingHtml(initials || "P")}</b>`, 'class="pt-profile"')}
    </header>
    <div class="pt-layout">
      <aside class="pt-sidebar">
        ${link(`/coalitions/${encodeURIComponent(organizationId)}`, `${textingIcon("back")}Organization`, 'class="pt-back"')}
        <span class="pt-nav-label">TEXTING</span>
        <nav aria-label="Texting">${navigation}</nav>
      </aside>
      <main class="pt-content" id="texting-content" tabindex="-1">${content}</main>
    </div>
  </section>`;
}

/** Keep typing stable when a scoped controller re-renders after validation. */
export function snapshotTextingFocus(root, identity) {
  const active = document.activeElement;
  if (
    !identity ||
    !root.contains(active) ||
    !active.closest(".texting-workspace") ||
    !active.matches("input,textarea,select")
  )
    return null;
  const fields = [
    ...root.querySelectorAll(
      ".texting-workspace input,.texting-workspace textarea,.texting-workspace select",
    ),
  ];
  return {
    identity,
    path: location.pathname,
    id: active.id,
    name: active.name,
    index: fields.indexOf(active),
    openDetails: [...root.querySelectorAll(".texting-workspace details")].map(
      (details) => details.open,
    ),
    tag: active.tagName,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

export function restoreTextingFocus(root, snapshot, identity) {
  if (
    !snapshot ||
    snapshot.identity !== identity ||
    snapshot.path !== location.pathname
  )
    return;
  [...root.querySelectorAll(".texting-workspace details")].forEach(
    (details, index) => {
      if (snapshot.openDetails?.[index]) details.open = true;
    },
  );
  const fields = [
    ...root.querySelectorAll(
      ".texting-workspace input,.texting-workspace textarea,.texting-workspace select",
    ),
  ];
  const field = snapshot.id
    ? fields.find((item) => item.id === snapshot.id)
    : snapshot.name
      ? fields.find((item) => item.name === snapshot.name)
      : fields[snapshot.index];
  if (!field || field.disabled || field.tagName !== snapshot.tag) return;
  field.focus({ preventScroll: true });
  if (
    Number.isInteger(snapshot.start) &&
    typeof field.setSelectionRange === "function"
  ) {
    try {
      field.setSelectionRange(snapshot.start, snapshot.end);
    } catch {
      /* Some input types have no text selection. */
    }
  }
}
