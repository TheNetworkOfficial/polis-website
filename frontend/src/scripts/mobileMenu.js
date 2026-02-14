/**
 * Registers open/close controls for the shared mobile navigation panel.
 */
document.addEventListener("dynamicContentLoaded", () => {
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("mobileMenu");
  const closeBtn = document.getElementById("mobileMenuClose");
  const overlay = document.getElementById("mobileMenuOverlay");

  if (!toggle || !menu || !closeBtn || !overlay) {
    return;
  }

  const setMenuState = (isOpen) => {
    menu.classList.toggle("open", isOpen);
    menu.hidden = !isOpen;
    overlay.hidden = !isOpen;
    toggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("mobile-menu-open", isOpen);
  };

  setMenuState(false);

  toggle.addEventListener("click", () => setMenuState(true));
  closeBtn.addEventListener("click", () => setMenuState(false));
  overlay.addEventListener("click", () => setMenuState(false));

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenuState(false));
  });
});
