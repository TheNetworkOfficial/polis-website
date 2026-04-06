import "./css/404.css";

const path = window.location.pathname;
if (path.startsWith("/cta-invite/")) {
  const token = path.split("/").filter(Boolean)[1] || "";
  if (token) {
    window.location.replace(`/cta-invite/index.html?token=${encodeURIComponent(token)}`);
  }
}
