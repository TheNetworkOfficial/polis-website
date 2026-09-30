const ordered = (value) =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, ordered(value[key])]),
        )
      : value;
const cacheKey = (value) => JSON.stringify(ordered(value));

/** Bounded session memory; pages from different permissions or versions never mix. */
export function createContactPageCache({
  maxPages = 8,
  maxBytes = 2097152,
  lifetime = 15000,
  now = Date.now,
} = {}) {
  const pages = new Map();
  let context = null,
    owner = null,
    bytes = 0;
  const clear = () => {
    pages.clear();
    context = null;
    owner = null;
    bytes = 0;
  };
  const put = (currentOwner, query, page) => {
    const names = [
      "accessFingerprint",
      "schemaRevision",
      "indexGeneration",
      "bookRevision",
    ];
    if (names.some((name) => page[name] == null) || page.queryHash == null) {
      clear();
      return;
    }
    const next = cacheKey([
      currentOwner,
      {
        ...Object.fromEntries(names.map((name) => [name, page[name]])),
        authorizationRevision: page.authorizationRevision ?? null,
        publication: page.publication ?? null,
      },
    ]);
    if (context !== next) clear();
    context = next;
    owner = currentOwner;
    const key = cacheKey([context, query]),
      json = JSON.stringify(page),
      size = new TextEncoder().encode(json).length;
    if (pages.has(key)) {
      bytes -= pages.get(key).bytes;
      pages.delete(key);
    }
    if (size > maxBytes || maxPages < 1) return;
    while (pages.size && (pages.size >= maxPages || bytes + size > maxBytes)) {
      const first = pages.keys().next().value;
      bytes -= pages.get(first).bytes;
      pages.delete(first);
    }
    pages.set(key, { json, bytes: size, at: now() });
    bytes += size;
  };
  const get = (currentOwner, query) => {
    if (!context || owner !== currentOwner) return null;
    const key = cacheKey([context, query]),
      value = pages.get(key);
    if (!value) return null;
    pages.delete(key);
    if (now() - value.at >= lifetime) {
      bytes -= value.bytes;
      return null;
    }
    pages.set(key, value);
    return JSON.parse(value.json);
  };
  return {
    clear,
    put,
    get,
    get size() {
      return pages.size;
    },
    get bytes() {
      return bytes;
    },
  };
}

/** The shared book never uses the provider API or performs external geocoding. */
export function createOrganizationContactsApi({
  request,
  scopeKey,
  guard = () => {},
}) {
  const base = `/api/contact-book/scopes/${encodeURIComponent(scopeKey)}`;
  const cache = createContactPageCache();
  let epoch = 0;
  const invalidate = () => {
    epoch++;
    cache.clear();
  };
  const active = () => {
    try {
      guard();
    } catch (error) {
      invalidate();
      throw error;
    }
  };
  const api = async (
    suffix,
    body,
    method,
    { signal, refresh = false, isCurrent = () => true } = {},
  ) => {
    active();
    if (signal?.aborted)
      throw new DOMException("Search cancelled", "AbortError");
    const verb = method || (body === undefined ? "GET" : "POST");
    if (
      (verb !== "GET" && !["/query", "/import-preview"].includes(suffix)) ||
      suffix === "/schema"
    )
      invalidate();
    const version = epoch;
    if (suffix === "/query" && !refresh) {
      const page = cache.get(scopeKey, body);
      if (page) return { ...page, fromCache: true };
    }
    let result;
    try {
      result = await request(`${base}${suffix}`, {
        auth: true,
        beforeRequest: active,
        ...(signal ? { signal } : {}),
        ...(body === undefined ? {} : { method: method || "POST", body }),
      });
    } catch (error) {
      if (error?.name !== "AbortError") invalidate();
      const code = error?.payload?.error || error?.code || error?.message;
      const messages = {
        contact_import_row_changed:
          "A previously saved record differs in this file. Reselect the original unchanged file to resume; the existing import remains saved.",
        contact_selection_duplicate_endpoints:
          "Selected contacts share a phone number. Keep one person per shared number or choose separate eligible numbers, then review again.",
        contact_book_changed:
          "Contacts changed while this view was open. Refresh the results and review your selection again.",
        contact_index_updating:
          "Contact updates are still being indexed. Refresh in a moment to see the complete result.",
        contact_index_preparation_required:
          "This filter or sort needs a search index. A contact manager can prepare it.",
        contact_revision_conflict:
          "This contact was updated elsewhere. Reopen it to review the latest information before saving.",
        contact_selection_changed:
          "The selected contacts changed. Clear and review the selection again.",
      };
      if (messages[code]) error.message = messages[code];
      throw error;
    }
    active();
    if (result?.ok !== true)
      throw new Error("The contact book response could not be verified.");
    if (
      suffix === "/query" &&
      epoch === version &&
      !signal?.aborted &&
      isCurrent()
    )
      cache.put(scopeKey, body, result);
    return result;
  };
  api.invalidate = invalidate;
  return api;
}
