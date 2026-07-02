/**
 * Adds an active class to navigation links matching the current page path.
 */
document.addEventListener("dynamicContentLoaded", () => {
  const normalizeNavPath = (value) => {
    let pathname = "/";
    try {
      pathname = new URL(value, window.location.origin).pathname;
    } catch {
      pathname = value || "/";
    }
    const withoutExtension = pathname.replace(/\.html$/u, "");
    const withoutTrailingSlash =
      withoutExtension.length > 1
        ? withoutExtension.replace(/\/$/u, "")
        : withoutExtension;
    return withoutTrailingSlash === "/index" ? "/" : withoutTrailingSlash;
  };

  const currentPath = normalizeNavPath(window.location.pathname);

  document
    .querySelectorAll("[data-nav-group] a[data-nav-link]")
    .forEach((link) => {
      const linkHref = link.getAttribute("href") || "";
      const linkPath = normalizeNavPath(linkHref.split("#")[0]);
      const isActive = linkPath === currentPath;

      if (isActive) {
        link.classList.add("is-active");
      } else {
        link.classList.remove("is-active");
      }
    });
});
