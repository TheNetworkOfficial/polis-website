import { customerText } from "./textingWorkspaceUi";
import { textingRoute } from "./textingShell";

export function textingNotificationRoute(item) {
  const target = item?.target || {};
  if (item?.kind !== "texting" || target.surfaceType !== "texting_settings")
    return "";
  const scope = String(target.scopeKey || "");
  const organization = scope.startsWith("coalition:") ? scope.slice(10) : "";
  return organization && !/[\s/\\]/.test(organization)
    ? textingRoute(organization, "settings")
    : "";
}

export const textingNotificationTitle = (item) =>
  customerText(item?.title) || "Opt-in texting update";
export const textingNotificationBody = (item) =>
  customerText(item?.preview?.textSnippet || item?.body);
