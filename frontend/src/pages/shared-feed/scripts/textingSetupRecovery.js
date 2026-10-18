const valid = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);

/** Retain only an opaque create identity. Drafts, contacts, money and tokens stay out of this record. */
export function createTextingSetupRecovery({
  context,
  storage = () => globalThis.sessionStorage,
  location = () => globalThis.location,
  history = () => globalThis.history,
}) {
  const key = () => {
    const actor = context();
    return `polis.texting.setup.request.v1.${encodeURIComponent(actor.userId)}.${encodeURIComponent(actor.organizationId)}`;
  };
  function url() {
    try {
      return new URL(location()?.href);
    } catch {
      return null;
    }
  }
  function read() {
    try {
      const value = storage()?.getItem(key());
      if (valid(value)) return value;
    } catch {
      /* URL recovery works when tab storage is disabled. */
    }
    const value = url()?.searchParams.get("setupRequest");
    return valid(value) ? value : null;
  }
  function save(requestId) {
    if (!valid(requestId)) throw new Error("setup_request_invalid");
    try {
      storage()?.setItem(key(), requestId);
    } catch {
      /* Opaque URL recovery remains available. */
    }
    const current = url();
    if (current) {
      current.searchParams.set("setupRequest", requestId);
      try {
        history()?.replaceState(
          history()?.state,
          "",
          `${current.pathname}${current.search}${current.hash}`,
        );
      } catch {
        /* Existing tab storage remains available. */
      }
    }
  }
  function clear() {
    try {
      storage()?.removeItem(key());
    } catch {
      /* The saved operation remains on the server. */
    }
    const current = url();
    if (current?.searchParams.has("setupRequest")) {
      current.searchParams.delete("setupRequest");
      try {
        history()?.replaceState(
          history()?.state,
          "",
          `${current.pathname}${current.search}${current.hash}`,
        );
      } catch {
        /* Navigation to the saved setup also clears the URL. */
      }
    }
  }
  return { read, save, clear };
}
