/**
 * Adds an active class to navigation links matching the current page path.
 */
document.addEventListener("dynamicContentLoaded", () => {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";

  document
    .querySelectorAll("[data-nav-group] a[data-nav-link]")
    .forEach((link) => {
      const linkHref = link.getAttribute("href") || "";
      const linkPath = linkHref.split("#")[0] || "index.html";
      const isActive = linkPath === currentPath;

      if (isActive) {
        link.classList.add("is-active");
      } else {
        link.classList.remove("is-active");
      }
    });
});
