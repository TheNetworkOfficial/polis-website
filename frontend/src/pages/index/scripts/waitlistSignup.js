/**
 * Submits waitlist details to the existing mailing-list endpoint and displays
 * inline feedback for success and error states.
 */
function initializeWaitlistForm() {
  const form = document.getElementById("waitlist-form");
  const feedback = document.getElementById("waitlist-feedback");

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
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();

    if (!email && !phone) {
      setFeedback("Enter an email, a phone number, or both.", "error");
      return;
    }

    try {
      const response = await fetch("/api/mailing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.error || "Unable to save your waitlist request.",
        );
      }

      form.reset();
      setFeedback(
        "You are on the waitlist. We will send launch updates soon.",
        "success",
      );
    } catch (error) {
      setFeedback(error.message, "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", initializeWaitlistForm);
