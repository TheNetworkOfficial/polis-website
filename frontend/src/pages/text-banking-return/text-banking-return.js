import "./css/text-banking-return.css";

const routeContent = {
  "/text-banking/billing/success": {
    eyebrow: "Text banking billing",
    title: "Checkout complete",
    message:
      "Checkout has returned you to Polis. Switch back to the Polis app and tap Refresh status to confirm your subscription.",
    note: "Polis verifies payment through a signed payment confirmation. This browser page cannot approve or activate billing.",
  },
  "/text-banking/billing": {
    eyebrow: "Text banking billing",
    title: "Return to Polis",
    message:
      "This billing page is closed. Switch back to the Polis app and tap Refresh status to review your current billing state.",
    note: "Polis verifies payment through a signed payment confirmation. This browser page cannot approve or activate billing.",
  },
  "/text-banking/registration-payment/success": {
    eyebrow: "Sender registration payment",
    title: "Payment checkout complete",
    message:
      "Switch back to the Polis app and tap Refresh status to continue sender setup.",
    note: "Polis verifies payment through a signed payment confirmation. Separate authorization is still required before registration can start.",
  },
  "/text-banking/registration-payment": {
    eyebrow: "Sender registration payment",
    title: "Return to sender setup",
    message:
      "This payment page is closed. Switch back to the Polis app and tap Refresh status to review or retry the payment.",
    note: "Polis verifies payment through a signed payment confirmation. This page does not submit a registration.",
  },
};

if (window.location.search || window.location.hash) {
  window.history.replaceState({}, "", window.location.pathname);
}

const normalizedPath = window.location.pathname.replace(/\/$/u, "");
const content =
  routeContent[normalizedPath] || routeContent["/text-banking/billing"];

document.querySelector("[data-return-eyebrow]").textContent = content.eyebrow;
document.querySelector("[data-return-title]").textContent = content.title;
document.querySelector("[data-return-message]").textContent = content.message;
document.querySelector("[data-return-note]").textContent = content.note;
