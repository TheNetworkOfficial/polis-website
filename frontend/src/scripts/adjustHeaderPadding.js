/**
 * Sets page top padding so fixed header never overlaps page content.
 */
function updateHeaderOffset() {
  const header = document.querySelector(".site-header");
  if (!header) {
    return;
  }

  document.body.style.paddingTop = `${header.offsetHeight}px`;
}

document.addEventListener("dynamicContentLoaded", updateHeaderOffset);
window.addEventListener("resize", updateHeaderOffset);
