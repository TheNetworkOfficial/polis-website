import { customerText } from "./textingWorkspaceUi";
import { textingRoute } from "./textingShell";

export function textingNotificationRoute(item) {
  const target = item?.target || {};
  if (item?.kind !== "texting") return "";
  const scope = String(target.scopeKey || "");
  const organization = scope.startsWith("coalition:") ? scope.slice(10) : "";
  if (!organization || /[\s/\\]/.test(organization)) return "";
  if (
    target.surfaceType === "text_banking_workspace" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(target.conversationId || "")
  )
    return textingRoute(organization, "conversation", target.conversationId);
  return target.surfaceType === "texting_settings"
    ? textingRoute(organization, "settings")
    : "";
}

export const textingNotificationTitle = (item) =>
  customerText(item?.title) ||
  (item?.target?.surfaceType === "text_banking_workspace"
    ? "New texting reply"
    : "Opt-in texting update");
export const textingNotificationBody = (item) =>
  customerText(item?.preview?.textSnippet || item?.body);
