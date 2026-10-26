function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/gu, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character];
  });
}

/** Shared account layout for full-page and in-context browser sign-in. */
export function renderPolisAuthLayout({
  logoUrl,
  heading,
  copy,
  body,
  footer = "",
  modal = false,
}) {
  const headingTag = modal ? "h2" : "h1";
  return `<div class="polis-auth__layout">
    <aside class="polis-auth__story" aria-label="Polis">
      <a class="polis-auth__brand" href="/feed" data-action="navigate" data-route="/feed"><img src="${escapeHtml(logoUrl)}" alt="" width="48" height="48"><span>Polis</span></a>
      <div class="polis-auth__story-copy">
        <p class="polis-auth__eyebrow">YOUR COMMUNITY. CONNECTED.</p>
        <h2>Good people.<span>Real progress.</span></h2>
        <p>Connect with your community and turn shared ideas into action.</p>
      </div>
      <div class="polis-auth__features" aria-label="Your Polis workspace">
        <div><span aria-hidden="true">01</span><p>Conversations that matter</p></div>
        <div><span aria-hidden="true">02</span><p>Your team, working together</p></div>
        <div><span aria-hidden="true">03</span><p>Action in your community</p></div>
      </div>
    </aside>
    <div class="polis-auth__main">
      <div class="polis-auth__content">
        <header class="polis-auth__heading"><p class="polis-auth__eyebrow">POLIS ACCOUNT</p><${headingTag} id="polis-auth-title" tabindex="-1">${escapeHtml(heading)}</${headingTag}><p id="polis-auth-description">${escapeHtml(copy)}</p></header>
        ${body}
      </div>
      <footer class="polis-auth__footer">${footer}<p>Read our <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p></footer>
    </div>
  </div>`;
}

export function renderPolisAuthPassword({
  name = "password",
  value = "",
  autocomplete = "current-password",
  field = "",
  label = "Password",
  hint = "",
  recoveryUrl = "",
  minimum = false,
}) {
  const id = `polis-auth-${name}`;
  return `<div class="polis-auth__field">
    <div class="polis-auth__field-heading"><label for="${id}">${escapeHtml(label)}</label>${recoveryUrl ? `<a href="${escapeHtml(recoveryUrl)}" data-action="navigate" data-route="${escapeHtml(recoveryUrl)}">Forgot password?</a>` : ""}</div>
    <div class="polis-auth__password"><input id="${id}" name="${escapeHtml(name)}" type="password" autocomplete="${escapeHtml(autocomplete)}"${field ? ` data-auth-field="${escapeHtml(field)}"` : ""} value="${escapeHtml(value)}" required${minimum ? ' minlength="8"' : ""}${hint ? ` aria-describedby="${id}-hint"` : ""}><button class="polis-auth__reveal" type="button" data-action="auth-toggle-password" aria-label="Show ${escapeHtml(label.toLowerCase())}" aria-pressed="false">Show</button></div>
    ${hint ? `<small id="${id}-hint">${escapeHtml(hint)}</small>` : ""}
  </div>`;
}

export function renderPolisAuthProviders({
  capabilities,
  action,
  pending = false,
}) {
  if (!capabilities.hosted) return "";
  return `<div class="polis-auth__divider"><span>or</span></div>
    ${capabilities.google ? `<button class="shared-feed-chip polis-auth__provider" type="button" data-action="${action}" data-auth-provider="Google"${pending ? " disabled" : ""}><span class="polis-auth__google" aria-hidden="true">G</span>Continue with Google</button>` : ""}
    <button class="polis-auth__options" type="button" data-action="${action}"${pending ? " disabled" : ""}>More sign-in options <span aria-hidden="true">↗</span></button>`;
}

/** Preserve live values and focus when the existing app shell replaces its DOM. */
export function createPolisAuthInteractions() {
  let trigger = null;
  let wasOpen = false;
  let lastSurface = "";
  const focusKey = (element) => {
    if (!element) return null;
    const key = ["id", "name", "data-action"]
      .map((attribute) => [attribute, element.getAttribute(attribute)])
      .find(([, value]) => value);
    if (!key) return null;
    const scope = element.closest(".polis-auth, #shared-feed-app") || document;
    const matches = Array.from(scope.querySelectorAll(`[${key[0]}]`)).filter(
      (item) => item.getAttribute(key[0]) === key[1],
    );
    return [...key, matches.indexOf(element)];
  };
  const findFocus = (container, key) =>
    key &&
    Array.from(container.querySelectorAll(`[${key[0]}]`)).filter(
      (element) => element.getAttribute(key[0]) === key[1],
    )[key[2]];
  return {
    rememberTrigger() {
      if (!wasOpen) trigger = focusKey(document.activeElement);
    },
    beforeRender(root) {
      const surface = root.querySelector(".polis-auth");
      const form = surface?.querySelector("form");
      return {
        surfaceKey: lastSurface,
        formKey: form?.dataset.routeForm,
        focus: surface?.contains(document.activeElement)
          ? focusKey(document.activeElement)
          : null,
        fields: Array.from(form?.querySelectorAll("input") || []).map(
          (input) => ({
            name: input.name,
            value: input.value,
            renderedValue: input.defaultValue,
            type: input.type,
            start: input.selectionStart,
            end: input.selectionEnd,
          }),
        ),
      };
    },
    afterRender(root, snapshot) {
      const modal = root.querySelector(
        ".shared-auth-modal.is-open .polis-auth",
      );
      const surface = modal || root.querySelector(".polis-auth--page");
      const form = surface?.querySelector("form");
      const surfaceKey = surface
        ? `${modal ? "modal" : window.location.pathname}:${form?.dataset.routeForm || "status"}`
        : "";
      const sameSurface = snapshot?.surfaceKey === surfaceKey;
      if (sameSurface && form && snapshot.formKey === form.dataset.routeForm) {
        for (const field of snapshot.fields) {
          const input = Array.from(form.querySelectorAll("input")).find(
            (item) => item.name === field.name,
          );
          if (!input) continue;
          if (input.defaultValue === field.renderedValue)
            input.value = field.value;
          if (input.autocomplete.includes("password")) {
            input.type = field.type;
            const reveal = input.parentElement.querySelector(
              ".polis-auth__reveal",
            );
            if (reveal) {
              reveal.textContent = input.type === "text" ? "Hide" : "Show";
              reveal.setAttribute(
                "aria-pressed",
                String(input.type === "text"),
              );
              reveal.setAttribute(
                "aria-label",
                `${input.type === "text" ? "Hide" : "Show"} ${input.name === "confirmPassword" ? "confirm password" : input.autocomplete === "new-password" ? "new password" : "password"}`,
              );
            }
          }
        }
      }
      root.querySelectorAll(".shared-feed-shell").forEach((shell) => {
        shell.inert = Boolean(modal);
      });
      document.body.classList.toggle("polis-auth-modal-open", Boolean(modal));
      if (sameSurface && snapshot?.focus) {
        const focused = findFocus(surface, snapshot.focus);
        focused?.focus({ preventScroll: true });
        const field = snapshot.fields.find(
          (item) => item.name === focused?.name,
        );
        if (
          field &&
          field.start !== null &&
          ["text", "password", "search", "tel", "url"].includes(focused.type)
        )
          focused.setSelectionRange(field.start, field.end);
      } else if (surface && (modal || surfaceKey !== lastSurface)) {
        (surface.querySelector("#polis-auth-title") || surface).focus({
          preventScroll: true,
        });
      } else if (wasOpen && !modal) {
        findFocus(root, trigger)?.focus({ preventScroll: true });
      }
      wasOpen = Boolean(modal);
      lastSurface = surfaceKey;
    },
    togglePassword(button) {
      const input = button
        .closest(".polis-auth__password")
        ?.querySelector("input");
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      button.textContent = input.type === "password" ? "Show" : "Hide";
      button.setAttribute("aria-pressed", String(input.type === "text"));
      button.setAttribute(
        "aria-label",
        `${input.type === "text" ? "Hide" : "Show"} ${input.name === "confirmPassword" ? "confirm password" : input.autocomplete === "new-password" ? "new password" : "password"}`,
      );
    },
    trapFocus(event, root) {
      const dialog = root.querySelector(
        ".shared-auth-modal.is-open [role='dialog']",
      );
      if (!dialog || event.key !== "Tab") return false;
      const controls = Array.from(
        dialog.querySelectorAll(
          "a[href], button:not(:disabled), input:not(:disabled), [tabindex='0']",
        ),
      ).filter((element) => element.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !controls.includes(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !controls.includes(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
      return true;
    },
  };
}
