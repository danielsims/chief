import type { RecurringWorkRecord } from "@chief/agent-runtime/types";

export type ScheduleFrequency =
  "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export function isScheduleFrequency(value: string): value is ScheduleFrequency {
  return ["daily", "weekdays", "weekly", "monthly", "custom"].includes(value);
}

const WEEKDAY_OPTIONS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

export interface ScheduleFields {
  frequency: ScheduleFrequency;
  time: string; // HH:MM
  weekday: string; // 0-6 for weekly
  dayOfMonth: string; // 1-31 for monthly
  custom: string; // raw cron for the escape hatch
}

/** Reads a cron into friendly fields when it matches a simple shape. */
export function fieldsFromCron(cron: string): ScheduleFields {
  const fallback: ScheduleFields = {
    frequency: "custom",
    time: "09:00",
    weekday: "1",
    dayOfMonth: "1",
    custom: cron,
  };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [minute = "", hour = "", dom = "", month = "", dow = ""] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour) || month !== "*") {
    return fallback;
  }
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (dom === "*" && dow === "*") {
    return { ...fallback, frequency: "daily", time };
  }
  if (dom === "*" && dow === "1-5") {
    return { ...fallback, frequency: "weekdays", time };
  }
  if (dom === "*" && /^[0-6]$/.test(dow)) {
    return { ...fallback, frequency: "weekly", time, weekday: dow };
  }
  if (/^\d{1,2}$/.test(dom) && dow === "*") {
    return { ...fallback, frequency: "monthly", time, dayOfMonth: dom };
  }
  return fallback;
}

export function cronFromFields(fields: ScheduleFields): string {
  if (fields.frequency === "custom") return fields.custom.trim();
  const [hour = "9", minute = "0"] = fields.time.split(":");
  const m = String(Number(minute));
  const h = String(Number(hour));
  if (fields.frequency === "daily") return `${m} ${h} * * *`;
  if (fields.frequency === "weekdays") return `${m} ${h} * * 1-5`;
  if (fields.frequency === "weekly") return `${m} ${h} * * ${fields.weekday}`;
  return `${m} ${h} ${Number(fields.dayOfMonth)} * *`;
}

export function friendlySchedule(work: RecurringWorkRecord) {
  if (work.triggerMode === "webhook") return "On webhook delivery";
  if (work.onceAt !== undefined) {
    return new Date(work.onceAt).toLocaleString([], {
      timeZone: work.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const fields = fieldsFromCron(work.cron);
  if (fields.frequency === "custom") return "Custom schedule";
  const time = new Date(`2000-01-01T${fields.time}:00`).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (fields.frequency === "daily") return `Every day at ${time}`;
  if (fields.frequency === "weekdays") return `Weekdays at ${time}`;
  if (fields.frequency === "weekly") {
    const weekday = WEEKDAY_OPTIONS.find(
      (option) => option.value === fields.weekday,
    )?.label;
    return `Every ${weekday ?? "week"} at ${time}`;
  }
  return `Monthly on day ${fields.dayOfMonth} at ${time}`;
}

export function approvalTiming(work: RecurringWorkRecord) {
  return `${friendlySchedule(work)} · ${work.timezone}`;
}

export function conciseApprovalSummary(work: RecurringWorkRecord) {
  const summary = work.approvalSummary.replace(/\s+/g, " ").trim();
  if (
    !summary ||
    summary.toLocaleLowerCase() === work.title.toLocaleLowerCase()
  ) {
    return null;
  }
  if (summary.length <= 260) return summary;
  const shortened = summary.slice(0, 257);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 180 ? lastSpace : 257)}…`;
}

export function friendlyPermission(pattern: string) {
  const action = pattern.split(".").at(-1) ?? pattern;
  const words = action
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words
    ? words.charAt(0).toLocaleUpperCase() + words.slice(1)
    : "Use connected data";
}
