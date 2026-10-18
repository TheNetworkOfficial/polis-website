/** Only the separately deployed setup API may receive setup credentials. */
export function textingSetupApiBase(config) {
  if (
    config?.schema !== "POLIS_TEXTING_SETUP_CONFIG_V1" ||
    config.enabled !== true
  )
    return "";
  const value = String(config.apiBaseUrl || "");
  return /^https:\/\/[a-z0-9]{10}\.execute-api\.us-west-2\.amazonaws\.com\/prod$/.test(
    value,
  )
    ? value
    : "";
}

export function createTextingSetupTransport({
  fetch: read = globalThis.fetch,
  headers,
}) {
  return async (path, { body, method = "GET", signal, beforeRequest } = {}) => {
    if (
      !/^\/api\/texting\/setup\/coalition\/[A-Za-z0-9_-]+(?:\/requests\/[A-Za-z0-9_-]{1,160}|\/drafts(?:\/[A-Za-z0-9_-]+(?:\/(?:prepare|resume|takeover|publish|handoff|reconcile))?)?)?(?:\?cursor=[A-Za-z0-9%_.~-]+)?$/.test(
        path,
      )
    )
      throw new Error("setup_route_invalid");
    const authorization = headers(path);
    // Re-read the public admission switch; unavailable setup never redirects an incumbent request.
    const configResponse = await read("/texting-setup-config.json", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    });
    const base = configResponse.ok
      ? textingSetupApiBase(await configResponse.json())
      : "";
    if (!base) throw new Error("setup_unavailable");
    beforeRequest?.();
    const response = await read(`${base}${path}`, {
      method,
      signal,
      credentials: "omit",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...authorization,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("setup_request_failed");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };
}

/** A setup response cannot turn its activation handoff into a send or a different campaign. */
export function textingSetupActivation(setup, organizationId) {
  const action = setup?.handoff?.action;
  if (!action) return null;
  const campaignId = setup?.campaignId;
  const revision = setup.handoff.expectedRevision;
  const prefix = `/api/text-banking/`;
  const tail = `/${encodeURIComponent(`coalition:${organizationId}`)}/campaigns/${encodeURIComponent(campaignId)}/transition`;
  if (
    !/^[A-Za-z0-9_-]{1,100}$/.test(campaignId || "") ||
    action.method !== "POST" ||
    ![`${prefix}workspaces${tail}`, `${prefix}prompt/scopes${tail}`].includes(
      action.path,
    ) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    action.body?.expectedRevision !== revision ||
    action.body?.action !== "activate" ||
    Object.keys(action.body).some(
      (key) => !["expectedRevision", "action"].includes(key),
    )
  )
    throw new Error("setup_handoff_invalid");
  return action;
}
