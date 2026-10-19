import { go, notice } from "./textingWorkspaceUi";

/** Discovery chooses only a new setup entry; it never changes an existing campaign. */
export function textingSetupEntryState(result) {
  const availability = result?.setupAvailability;
  const supported =
    Array.isArray(availability?.supportedWorkflowTypes) &&
    availability.supportedWorkflowTypes.includes("contact_book_single");
  const state = ["enabled", "paused", "unsupported", "unavailable"].includes(
    availability?.state,
  )
    ? availability.state
    : "unavailable";
  return {
    state:
      state === "enabled" &&
      (!supported || result?.capabilities?.isolatedSetup !== true)
        ? "unavailable"
        : state,
    canCreate:
      state === "enabled" &&
      supported === true &&
      result?.capabilities?.isolatedSetup === true &&
      result.capabilities.createSetup === true &&
      result.capabilities.manageBilling === true,
  };
}

/** Keep failures and paused admissions visible; never silently create through another API. */
export function renderTextingSetupEntry(entry = { state: "unavailable" }) {
  const saved = go("setup", "Saved campaign setups", "", true);
  const other = go("campaigns", "Other campaign types", "new", true);
  const action = entry.canCreate
    ? go("setup", "New campaign", "new")
    : entry.state === "unsupported"
      ? other
      : go("setup", "Check campaign setup");
  const message =
    entry.state === "paused"
      ? notice(
          "New campaign setup is paused",
          "Continue or check your saved setups. Existing campaigns remain available.",
        )
      : entry.state === "unsupported"
        ? notice(
            "Use the existing campaign workflow",
            "Guided Contact Book setup is not enabled for this organization. Choose Other campaign types to review the available workflow.",
          )
        : entry.state !== "enabled"
          ? notice(
              "Campaign setup status is unavailable",
              "Check saved setups before creating another campaign. Existing campaigns remain available.",
            )
          : "";
  return {
    action,
    content: `${message}<div class="pt-actions">${saved}${entry.state === "enabled" ? other : ""}</div>`,
  };
}

/** Read-only discovery is limited to the campaign list and fenced to actor, organization and route. */
export function createTextingSetupEntry({ request, context, changed }) {
  let view = {},
    sequence = 0;
  const identity = () => {
    const c = context();
    return c?.userId && c?.organizationId
      ? `${c.userId}:${c.organizationId}`
      : "";
  };
  const route = () => {
    const c = context();
    return `${identity()}:${c?.section || ""}:${c?.resourceId || ""}`;
  };
  const reset = () => {
    sequence++;
    view = {};
  };
  async function load() {
    const c = context(),
      key = identity(),
      location = route();
    if (
      !key ||
      (c.scopeType || "coalition") !== "coalition" ||
      c.section !== "campaigns" ||
      c.resourceId
    )
      return;
    const ticket = ++sequence;
    view = { key, state: "unavailable" };
    const guard = () => {
      if (ticket !== sequence || route() !== location)
        throw new Error("setup_context_changed");
    };
    try {
      const result = await request(
        `/api/texting/setup/coalition/${encodeURIComponent(c.organizationId)}`,
        { auth: true, beforeRequest: guard },
      );
      guard();
      view = { key, loaded: true, ...textingSetupEntryState(result) };
    } catch {
      if (ticket !== sequence || route() !== location) return;
      view = { key, loaded: true, state: "unavailable", canCreate: false };
    }
    changed();
  }
  return {
    load,
    reset,
    getState: () => (identity() === view.key ? view : { state: "unavailable" }),
  };
}
