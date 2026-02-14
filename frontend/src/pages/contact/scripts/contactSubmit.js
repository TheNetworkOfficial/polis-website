/**
 * Sends contact form submissions to the existing backend endpoint and displays
 * user-facing feedback messages.
 */
function initializeContactForm() {
  const form = document.getElementById("contact-form");
  const feedback = document.getElementById("contact-feedback");

  if (!form || !feedback) {
    return;
  }

  const setFeedback = (message, tone) => {
    feedback.textContent = message;
    feedback.dataset.tone = tone;
    feedback.classList.remove("hidden");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      zip: String(formData.get("zip") || "").trim(),
      subject: String(formData.get("subject") || "").trim(),
      message: String(formData.get("message") || "").trim(),
    };

    if (!payload.name || !payload.email || !payload.message) {
      setFeedback("Name, email, and message are required.", "error");
      return;
    }

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Unable to send your message.");
      }

      form.reset();
      setFeedback(
        "Message sent. We will reply as soon as possible.",
        "success",
      );
    } catch (error) {
      setFeedback(error.message, "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", initializeContactForm);
