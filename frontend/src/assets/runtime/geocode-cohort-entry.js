/* Upgrade an older SPA only when it enters an approved geocoding workspace.
 * The existing router runs its unsaved-work checks before writing history.
 * The current bundle marks itself ready and keeps its ordinary SPA behavior. */
(() => {
  if (window.__POLIS_GEOCODE_ENTRY_BRIDGE__) return;
  window.__POLIS_GEOCODE_ENTRY_BRIDGE__ = true;
  let navigating = false;
  const cohort =
    /^\/(?:workspace\/coalition|coalitions|organizations)\/(?:ns7aq23r|wnkwaes5)(?:\/|$)/;
  function refresh(url) {
    if (navigating || window.__POLIS_GEOCODE_COHORT_BUNDLE__) return;
    const destination = new URL(
      url || window.location.href,
      window.location.href,
    );
    if (
      destination.origin !== window.location.origin ||
      !cohort.test(destination.pathname)
    )
      return;
    navigating = true;
    window.location.replace(destination.href);
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      refresh(args[2]);
      return result;
    };
  }
  window.addEventListener("popstate", () => refresh());
})();
