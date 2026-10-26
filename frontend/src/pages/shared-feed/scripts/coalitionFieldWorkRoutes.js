/** Preserve old bookmarks while moving tools to the page that owns their work. */
export function canonicalCoalitionFieldWorkPath(pathname, search = "") {
  const match =
    /^\/coalitions\/([^/]+)\/(?:voter-map|field-work)(?:\/(.*))?\/?$/u.exec(
      pathname || "",
    );
  if (!match) return "";
  const base = `/coalitions/${match[1]}`;
  const section = (match[2] || "").replace(/\/$/u, "");
  const query = new URLSearchParams(search);
  let target = "";
  if (section === "members") target = `${base}/members/directory`;
  else if (section === "cta") target = `${base}/calendar/field-events`;
  else if (/^cta\/transport(?:\/[^/]+)?$/u.test(section)) {
    target = `${base}/calendar/field-events/transport`;
    const eventId = section.split("/")[2];
    if (eventId && !query.has("eventId")) {
      try {
        query.set("eventId", decodeURIComponent(eventId));
      } catch {
        return "";
      }
    }
  } else if (
    ["scripts", "outreach", "outreach-scripts", "outreach-templates"].includes(
      section,
    )
  ) {
    target = `${base}/admin/edit/outreach`;
  } else if (pathname.includes("/field-work")) {
    target = `${base}/voter-map${section ? `/${section}` : ""}`;
  }
  return target ? `${target}${query.size ? `?${query}` : ""}` : "";
}

/** These are data-maintenance destinations, not extra Field Work tabs. */
export function coalitionFieldToolOwner(parts = []) {
  if (parts[0] === "members" && parts[1] === "directory") return "members";
  if (parts[0] === "calendar" && parts[1] === "field-events") {
    return parts[2] === "transport" ? "cta/transport" : "cta";
  }
  if (parts[0] === "admin" && parts[1] === "edit" && parts[2] === "outreach")
    return "scripts";
  return "";
}
