/**
 * Injects shared header and footer templates into page placeholders and then
 * dispatches an event for scripts that depend on that markup.
 */
async function loadSharedLayout() {
  const headerPlaceholder = document.getElementById("header-placeholder");
  const footerPlaceholder = document.getElementById("footer-placeholder");

  if (!headerPlaceholder || !footerPlaceholder) {
    return;
  }

  try {
    const [headerData, footerData] = await Promise.all([
      fetch("header.html").then((response) => response.text()),
      fetch("footer.html").then((response) => response.text()),
    ]);

    headerPlaceholder.innerHTML = headerData;
    footerPlaceholder.innerHTML = footerData;
    document.dispatchEvent(new CustomEvent("dynamicContentLoaded"));
  } catch (error) {
    console.error("Failed to load shared layout:", error);
  }
}

document.addEventListener("DOMContentLoaded", loadSharedLayout);
