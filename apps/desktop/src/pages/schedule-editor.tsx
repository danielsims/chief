import { useState } from "react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import { CRON_FIELDS } from "./schedule-timeline";

type ScheduleFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom";

function isScheduleFrequency(value: string): value is ScheduleFrequency {
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

interface ScheduleFields {
  frequency: ScheduleFrequency;
  time: string; // HH:MM
  weekday: string; // 0-6 for weekly
  dayOfMonth: string; // 1-31 for monthly
  custom: string; // raw cron for the escape hatch
}

/** Reads a cron into friendly fields when it matches a simple shape. */
function fieldsFromCron(cron: string): ScheduleFields {
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

function cronFromFields(fields: ScheduleFields): string {
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
  if (work.onceAt !== undefined) {
    return new Date(work.onceAt).toLocaleString([], {
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

export function friendlyTimezone(timezone: string) {
  if (timezone === Intl.DateTimeFormat().resolvedOptions().timeZone) {
    return "your time";
  }
  const location = timezone.split("/").at(-1)?.replaceAll("_", " ");
  return `${location ?? timezone} time`;
}

export function approvalTiming(work: RecurringWorkRecord) {
  const timing = friendlySchedule(work);
  return work.onceAt === undefined
    ? `${timing} · ${friendlyTimezone(work.timezone)}`
    : timing;
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

export function RecurringWorkEditDialog({
  work,
  onClose,
  onSave,
}: {
  work: RecurringWorkRecord | null;
  onClose: () => void;
  onSave: (
    work: RecurringWorkRecord,
    patch: { title: string; cron: string; timezone: string },
  ) => void;
}) {
  const [title, setTitle] = useState(() => work?.title ?? "");
  const [timezone, setTimezone] = useState(() => work?.timezone ?? "");
  const [fields, setFields] = useState<ScheduleFields>(() =>
    fieldsFromCron(work?.cron ?? "0 9 * * *"),
  );

  const cron = cronFromFields(fields);
  const timezoneValid = (() => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  })();
  const dayOfMonthValid =
    fields.frequency !== "monthly" ||
    (Number(fields.dayOfMonth) >= 1 && Number(fields.dayOfMonth) <= 31);
  const valid =
    Boolean(title.trim()) &&
    CRON_FIELDS.test(cron) &&
    timezoneValid &&
    dayOfMonthValid;

  const patch = (next: Partial<ScheduleFields>) =>
    setFields((current) => ({ ...current, ...next }));

  const frequencies: { value: ScheduleFrequency; label: string }[] = [
    { value: "daily", label: "Every day" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <Dialog open={Boolean(work)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {work ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-normal">
                Edit schedule
              </DialogTitle>
              <DialogDescription>
                Change the timing directly, or ask for a change in the approval
                card and the agent will rework it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs">Title</label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs">Repeats</label>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={fields.frequency}
                    onValueChange={(value) => {
                      if (isScheduleFrequency(value))
                        patch({ frequency: value });
                    }}
                  >
                    <SelectTrigger className="h-9 w-36 text-sm">
                      {
                        frequencies.find(
                          (item) => item.value === fields.frequency,
                        )?.label
                      }
                    </SelectTrigger>
                    <SelectContent>
                      {frequencies.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fields.frequency === "weekly" ? (
                    <Select
                      value={fields.weekday}
                      onValueChange={(value) => patch({ weekday: value })}
                    >
                      <SelectTrigger className="h-9 w-32 text-sm">
                        {
                          WEEKDAY_OPTIONS.find(
                            (item) => item.value === fields.weekday,
                          )?.label
                        }
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {fields.frequency === "monthly" ? (
                    <Input
                      value={fields.dayOfMonth}
                      onChange={(event) =>
                        patch({ dayOfMonth: event.target.value })
                      }
                      className="h-9 w-20 text-sm"
                      placeholder="Day"
                    />
                  ) : null}
                  {fields.frequency !== "custom" ? (
                    <Input
                      type="time"
                      value={fields.time}
                      onChange={(event) => patch({ time: event.target.value })}
                      className="h-9 w-28 text-sm"
                    />
                  ) : null}
                </div>
                {fields.frequency === "custom" ? (
                  <div className="space-y-1">
                    <Input
                      value={fields.custom}
                      onChange={(event) =>
                        patch({ custom: event.target.value })
                      }
                      className="font-mono"
                      placeholder="0 8 * * 1"
                    />
                    <p className="text-muted-foreground text-[10px]">
                      minute · hour · day of month · month · day of week
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground font-mono text-[10px]">
                    {cron}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs">
                  Timezone
                </label>
                <Input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="Australia/Sydney"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!valid}
                onClick={() => {
                  onSave(work, {
                    title: title.trim(),
                    cron,
                    timezone: timezone.trim(),
                  });
                  onClose();
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
