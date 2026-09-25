import { escapeText as e, field, select, notice } from "./textingWorkspaceUi";

export function scheduleSummary(schedule) {
  return schedule?.timeZone && schedule?.startTime && schedule?.endTime
    ? `${schedule.startTime}–${schedule.endTime} daily · ${schedule.timeZone}`
    : "Sending hours awaiting verification";
}

export function scheduleFields(schedule, override, campaign = false) {
  if (schedule?.status !== "verified")
    return notice(
      "Sending hours need review",
      "Refresh after an administrator verifies the organization’s sending hours.",
    );
  const selected = override || schedule;
  return `${
    campaign
      ? select(
          "dailyHoursMode",
          "Daily sending hours",
          [
            ["organization", "Use organization hours"],
            ["custom", "Use shorter campaign hours"],
          ],
          override ? "custom" : "organization",
        )
      : ""
  }<p class="pt-muted">${campaign ? "Organization hours: " : ""}${e(scheduleSummary(schedule))}</p>${field("sendingTimeZone", "Reviewed timezone", schedule.timeZone, { extra: "readonly" })}<div class="pt-fields">${field("sendingStart", "Daily start", selected.startTime, { type: "time", required: true, extra: campaign ? `min="${e(schedule.startTime)}" max="${e(schedule.endTime)}"` : "" })}${field("sendingEnd", "Daily end", selected.endTime, { type: "time", required: true, extra: campaign ? `min="${e(schedule.startTime)}" max="${e(schedule.endTime)}"` : "" })}</div><p class="pt-muted">${campaign ? "Custom hours apply only when selected and must stay inside organization hours. " : ""}These hours allow individual manual sends. They do not schedule automatic messages. The timezone follows the reviewed texting service setup.</p>`;
}

/** Read clock times in the server's reviewed timezone, without browser timezone conversion. */
export function readSchedule(form, schedule, campaign = false) {
  const data = new FormData(form);
  if (campaign && data.get("dailyHoursMode") !== "custom") return null;
  if (schedule?.status !== "verified" || !schedule.timeZone)
    throw new Error("Refresh to verify your organization’s sending hours.");
  const startTime = String(data.get("sendingStart") || ""),
    endTime = String(data.get("sendingEnd") || "");
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
    startTime >= endTime
  )
    throw new Error("Choose a daily end time after the start time.");
  if (
    campaign &&
    (startTime < schedule.startTime || endTime > schedule.endTime)
  )
    throw new Error("Campaign hours must stay inside organization hours.");
  return { timeZone: schedule.timeZone, startTime, endTime };
}
