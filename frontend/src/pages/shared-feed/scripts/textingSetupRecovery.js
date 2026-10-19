const valid = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);

const schema = "POLIS_TEXTING_PENDING_CREATE_V2";
const fields = [
  "requestId",
  "name",
  "audienceId",
  "templateText",
  "mediaId",
  "budgetMicros",
  "deliveryNotBeforeMs",
  "deliveryBeforeMs",
  "assignedUserIds",
];

function canonical(body) {
  if (
    !body ||
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((key) => !fields.includes(key)) ||
    !valid(body.requestId) ||
    !valid(body.audienceId) ||
    typeof body.name !== "string" ||
    !body.name ||
    body.name.length > 200 ||
    typeof body.templateText !== "string" ||
    !body.templateText ||
    body.templateText.length > 10000 ||
    body.mediaId !== null ||
    !Number.isSafeInteger(body.budgetMicros) ||
    body.budgetMicros <= 0 ||
    !Number.isSafeInteger(body.deliveryNotBeforeMs) ||
    body.deliveryNotBeforeMs <= 0 ||
    !Number.isSafeInteger(body.deliveryBeforeMs) ||
    body.deliveryBeforeMs <= body.deliveryNotBeforeMs ||
    body.deliveryBeforeMs > 8640000000000000 ||
    !Array.isArray(body.assignedUserIds) ||
    !body.assignedUserIds.length ||
    body.assignedUserIds.length > 1000 ||
    body.assignedUserIds.some((id) => !valid(id)) ||
    new Set(body.assignedUserIds).size !== body.assignedUserIds.length
  )
    throw new Error("setup_pending_draft_invalid");
  return JSON.stringify(
    Object.fromEntries(
      fields.map((key) => [
        key,
        key === "assignedUserIds" ? [...body[key]].sort() : body[key],
      ]),
    ),
  );
}

async function fingerprint(body) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(body)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Tab-only recovery: opaque URL identity plus the exact actor/scope-bound draft, never contacts or credentials. */
export function createTextingSetupRecovery({
  context,
  storage = () => globalThis.sessionStorage,
  location = () => globalThis.location,
  history = () => globalThis.history,
}) {
  const key = () => {
    const actor = context();
    return `polis.texting.setup.request.v1.${encodeURIComponent(actor.userId)}.${encodeURIComponent(actor.organizationId)}`;
  };
  const draftKey = () => key().replace("request.v1.", "draft.v2.");
  const scope = () => {
    const actor = context();
    if (!actor?.userId || !actor?.organizationId)
      throw new Error("setup_context_changed");
    return { userId: actor.userId, organizationId: actor.organizationId };
  };
  const sameScope = (actor) => {
    const now = scope();
    if (
      now.userId !== actor.userId ||
      now.organizationId !== actor.organizationId
    )
      throw new Error("setup_context_changed");
  };
  function url() {
    try {
      return new URL(location()?.href);
    } catch {
      return null;
    }
  }
  function read() {
    try {
      const value = storage()?.getItem(key());
      if (valid(value)) return value;
      const raw = storage()?.getItem(draftKey());
      if (raw && raw.length <= 262144) {
        const saved = JSON.parse(raw),
          actor = scope();
        if (
          saved.schema === schema &&
          saved.userId === actor.userId &&
          saved.organizationId === actor.organizationId &&
          valid(saved.body?.requestId)
        )
          return saved.body.requestId;
      }
    } catch {
      /* URL recovery works when tab storage is disabled. */
    }
    const value = url()?.searchParams.get("setupRequest");
    return valid(value) ? value : null;
  }
  function save(requestId) {
    if (!valid(requestId)) throw new Error("setup_request_invalid");
    try {
      storage()?.setItem(key(), requestId);
    } catch {
      /* Opaque URL recovery remains available. */
    }
    const current = url();
    if (current) {
      current.searchParams.set("setupRequest", requestId);
      try {
        history()?.replaceState(
          history()?.state,
          "",
          `${current.pathname}${current.search}${current.hash}`,
        );
      } catch {
        /* Existing tab storage remains available. */
      }
    }
  }
  async function readDraft(requestId) {
    const actor = scope(),
      raw = storage()?.getItem(draftKey());
    if (!raw) return null;
    if (raw.length > 262144) throw new Error("setup_pending_draft_invalid");
    const saved = JSON.parse(raw);
    if (
      saved.schema !== schema ||
      saved.userId !== actor.userId ||
      saved.organizationId !== actor.organizationId ||
      saved.body?.requestId !== requestId ||
      Object.keys(saved).sort().join(",") !==
        "body,fingerprint,organizationId,schema,userId" ||
      saved.fingerprint !== (await fingerprint(saved.body))
    )
      throw new Error("setup_pending_draft_invalid");
    sameScope(actor);
    return saved.body;
  }
  async function saveDraft(body) {
    const actor = scope(),
      saved = {
        schema,
        ...actor,
        body: JSON.parse(canonical(body)),
        fingerprint: await fingerprint(body),
      };
    sameScope(actor);
    // The identity guard survives even if the draft write/readback fails. No POST may follow that failure.
    save(body.requestId);
    const raw = JSON.stringify(saved),
      tab = storage();
    if (!tab) throw new Error("setup_pending_storage_required");
    tab.setItem(draftKey(), raw);
    if (
      tab.getItem(draftKey()) !== raw ||
      tab.getItem(key()) !== body.requestId
    )
      throw new Error("setup_pending_storage_required");
    sameScope(actor);
    return saved.body;
  }
  function clear() {
    try {
      storage()?.removeItem(key());
      storage()?.removeItem(draftKey());
    } catch {
      /* The saved operation remains on the server. */
    }
    const current = url();
    if (current?.searchParams.has("setupRequest")) {
      current.searchParams.delete("setupRequest");
      try {
        history()?.replaceState(
          history()?.state,
          "",
          `${current.pathname}${current.search}${current.hash}`,
        );
      } catch {
        /* Navigation to the saved setup also clears the URL. */
      }
    }
  }
  return {
    read,
    save,
    readDraft,
    saveDraft,
    clear,
    matches: (left, right) => canonical(left) === canonical(right),
  };
}
