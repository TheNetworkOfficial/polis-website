import { bundledPolicy } from "./policySnapshot.js";
/** A verified full-text snapshot is read in this page; accepting is an authenticated server write. */
export async function verifyPolicyManifest(
  manifest,
  cryptoProvider = globalThis.crypto,
) {
  if (
    !manifest ||
    typeof manifest.policySetVersion !== "string" ||
    !manifest.policySetVersion ||
    typeof manifest.acknowledgementText !== "string" ||
    !Array.isArray(manifest.documents) ||
    manifest.documents.length !== 3
  )
    throw new Error("Policies could not be verified.");
  const ids = new Set();
  for (const doc of manifest.documents) {
    if (
      !["terms", "privacy", "child_safety"].includes(doc.id) ||
      ids.has(doc.id) ||
      typeof doc.content !== "string" ||
      !doc.content.trim() ||
      /<%|%>/.test(doc.content)
    )
      throw new Error("Policies could not be verified.");
    ids.add(doc.id);
    const digest = await cryptoProvider.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(doc.content),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== doc.sha256) throw new Error("Policies could not be verified.");
  }
  return manifest;
}

export function createPolicyAcceptanceController({ request, getUserId }) {
  let pending = null;
  const load = async () =>
    verifyPolicyManifest(await request("/api/policies/current"));
  const status = async () =>
    request("/api/me/policy-acceptance", { auth: true });
  const accept = async (manifest, actor, checked) => {
    if (!checked)
      throw new Error("Choose the agreement checkbox before continuing.");
    const checkActor = () => {
      if (!actor || getUserId() !== actor)
        throw new Error(
          "Your account changed. Close this review and open it again.",
        );
    };
    checkActor();
    await verifyPolicyManifest(manifest);
    checkActor();
    const receipt = await request("/api/me/policy-acceptance", {
      auth: true,
      method: "POST",
      body: {
        policySetVersion: manifest.policySetVersion,
        documentHashes: Object.fromEntries(
          manifest.documents.map((doc) => [doc.id, doc.sha256]),
        ),
        accepted: true,
        source: "web",
      },
      beforeDispatch: checkActor,
    });
    checkActor();
    if (
      receipt?.ok !== true ||
      receipt.accepted !== true ||
      receipt.policySetVersion !== manifest.policySetVersion
    )
      throw new Error("Your agreement was not confirmed. Retry to continue.");
    return receipt;
  };
  async function review({ force = false } = {}) {
    if (pending) return pending;
    const actor = getUserId();
    if (!actor) return false;
    pending = (async () => {
      if (!force) {
        try {
          const current = await status();
          if (getUserId() !== actor) return false;
          if (current?.ok === true && current.accepted === true) return true;
        } catch {
          /* Offer retry and browsing, never fabricate agreement. */
        }
      }
      return showPolicyReview({
        load,
        accept: (manifest, checked) => accept(manifest, actor, checked),
        getUserId,
        actor,
      });
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }
  return { load, status, accept, review };
}

function showPolicyReview({ load, accept, getUserId, actor }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "polis-policy-review";
    dialog.setAttribute("aria-label", "Review and agree to Polis policies");
    const title = document.createElement("h2");
    title.textContent = "Review & agree";
    const intro = document.createElement("p");
    intro.textContent =
      "Review the policies before sharing content. You can continue browsing without agreeing.";
    const content = document.createElement("div");
    const notice = document.createElement("p");
    notice.setAttribute("role", "status");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry loading policies";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = false;
    const label = document.createElement("label");
    const labelText = document.createElement("span");
    label.append(checkbox, labelText);
    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = "Agree & continue";
    submit.disabled = true;
    const browse = document.createElement("button");
    browse.type = "button";
    browse.textContent = "Continue browsing";
    let manifest = null,
      busy = false;
    const finish = (accepted) => {
      dialog.close();
      dialog.remove();
      resolve(accepted);
    };
    for (const button of [submit, browse, retry])
      button.className = "shared-feed-chip";
    submit.classList.add("shared-feed-chip--primary");
    const showDocuments = (result) => {
      content.replaceChildren();
      for (const doc of result.documents) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = `${doc.title} · ${doc.version}`;
        const text = document.createElement("div");
        text.className = "polis-policy-review__document";
        text.textContent = doc.content;
        details.append(summary, text);
        content.append(details);
      }
    };
    const reload = async () => {
      manifest = null;
      checkbox.checked = false;
      checkbox.disabled = true;
      submit.disabled = true;
      retry.disabled = true;
      content.replaceChildren();
      notice.textContent = "Loading verified policies…";
      try {
        const result = await load();
        if (getUserId() !== actor)
          throw new Error(
            "Your account changed. Close this review and open it again.",
          );
        manifest = result;
        showDocuments(result);
        labelText.textContent = result.acknowledgementText;
        checkbox.disabled = false;
        notice.textContent = "";
      } catch {
        try {
          showDocuments(await verifyPolicyManifest(bundledPolicy));
        } catch {
          content.replaceChildren();
        }
        notice.textContent =
          "Showing saved policy copies. Reconnect to load the active policies before agreeing, or continue browsing.";
      }
      retry.disabled = false;
    };
    checkbox.addEventListener("change", () => {
      submit.disabled = busy || !manifest || !checkbox.checked;
    });
    retry.addEventListener("click", reload);
    browse.addEventListener("click", () => {
      if (!busy) finish(false);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!busy) finish(false);
    });
    submit.addEventListener("click", async () => {
      if (busy || !manifest || !checkbox.checked) return;
      busy = true;
      submit.disabled = true;
      browse.disabled = true;
      retry.disabled = true;
      checkbox.disabled = true;
      try {
        await accept(manifest, checkbox.checked);
        finish(true);
      } catch (error) {
        if (error?.status === 409) {
          await reload();
          notice.textContent =
            "The policies changed. Review the current version and agree again.";
        } else
          notice.textContent =
            "Your agreement was not confirmed. Check your account and connection, then retry.";
      } finally {
        busy = false;
        submit.disabled = !manifest || !checkbox.checked;
        browse.disabled = false;
        retry.disabled = false;
        checkbox.disabled = !manifest;
      }
    });
    dialog.append(title, intro, content, label, notice, submit, browse, retry);
    document.body.append(dialog);
    dialog.showModal();
    reload();
  });
}
