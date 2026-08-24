import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import type { ScheduledWorkTrigger } from "@chief/channel-api";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

type HeartbeatMode = "hourly" | "daily" | "weekly" | "custom" | "webhook";
const HEARTBEAT_MODES: readonly HeartbeatMode[] = [
  "hourly",
  "daily",
  "weekly",
  "custom",
  "webhook",
];

function isHeartbeatMode(value: string): value is HeartbeatMode {
  return HEARTBEAT_MODES.some((mode) => mode === value);
}

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
] as const;
const CRON_FIELDS = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function initialFields(work: RecurringWorkRecord) {
  if (work.trigger?.type === "webhook") {
    return {
      mode: "webhook" as const,
      time: "09:00",
      weekday: "1",
      custom: "0 9 * * 1-5",
      timezone: localTimezone(),
    };
  }
  const cron =
    work.trigger?.type === "cron" ? work.trigger.expression : work.cron;
  const timezone =
    work.trigger?.type === "cron" ? work.trigger.timezone : work.timezone;
  if (cron === "0 * * * *") {
    return {
      mode: "hourly" as const,
      time: "09:00",
      weekday: "1",
      custom: cron,
      timezone,
    };
  }
  const parts = cron.trim().split(/\s+/);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (
    parts.length === 5 &&
    /^\d{1,2}$/.test(minute ?? "") &&
    /^\d{1,2}$/.test(hour ?? "") &&
    dayOfMonth === "*" &&
    month === "*"
  ) {
    const time = `${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`;
    if (dayOfWeek === "*") {
      return {
        mode: "daily" as const,
        time,
        weekday: "1",
        custom: cron,
        timezone,
      };
    }
    if (/^[0-6]$/.test(dayOfWeek ?? "")) {
      return {
        mode: "weekly" as const,
        time,
        weekday: dayOfWeek ?? "1",
        custom: cron,
        timezone,
      };
    }
  }
  return {
    mode: "custom" as const,
    time: "09:00",
    weekday: "1",
    custom: cron,
    timezone,
  };
}

function cronFor(
  mode: HeartbeatMode,
  time: string,
  weekday: string,
  custom: string,
) {
  if (mode === "hourly") return "0 * * * *";
  if (mode === "custom") return custom.trim();
  const [hour = "9", minute = "0"] = time.split(":");
  const prefix = `${Number(minute)} ${Number(hour)}`;
  return mode === "weekly" ? `${prefix} * * ${weekday}` : `${prefix} * * *`;
}

/** Edits the single Chief wake-up through the existing recurring-work record. */
export function MissionHeartbeatSettings({
  disabled,
  onRotateWebhook,
  onRunNow,
  onSave,
  work,
}: {
  disabled?: boolean;
  onRotateWebhook: () => Promise<{ url: string }>;
  onRunNow: () => Promise<void>;
  onSave: (work: RecurringWorkRecord) => Promise<RecurringWorkRecord>;
  work: RecurringWorkRecord;
}) {
  const initial = initialFields(work);
  const [mode, setMode] = useState<HeartbeatMode>(initial.mode);
  const [time, setTime] = useState(initial.time);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [custom, setCustom] = useState(initial.custom);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const cron = cronFor(mode, time, weekday, custom);
  const valid =
    mode === "webhook" ||
    (CRON_FIELDS.test(cron) &&
      (() => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone });
          return true;
        } catch {
          return false;
        }
      })());

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const trigger: ScheduledWorkTrigger =
        mode === "webhook"
          ? { type: "webhook" }
          : { type: "cron", expression: cron, timezone };
      await onSave({
        ...work,
        trigger,
        cron: trigger.type === "cron" ? trigger.expression : "0 0 1 1 *",
        timezone: trigger.type === "cron" ? trigger.timezone : "UTC",
      });
      if (mode === "webhook") {
        const rotated = await onRotateWebhook();
        setWebhookUrl(rotated.url);
        toast.success("Webhook ready to copy");
      } else {
        setWebhookUrl(null);
        toast.success("Heartbeat updated");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Chief could not update the heartbeat.",
      );
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    try {
      await onRunNow();
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : "Chief could not start this check.",
      );
      setRunning(false);
    }
  };

  return (
    <div className="border-border/70 border-t py-5">
      <div>
        <h2 className="text-sm font-medium">Chief heartbeat</h2>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          Chief wakes, checks the workspace, and decides whether anything needs
          attention.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Select
          value={mode}
          onValueChange={(value) => {
            if (isHeartbeatMode(value)) setMode(value);
          }}
        >
          <SelectTrigger className="bg-muted/55 h-10 min-w-36 rounded-xl border-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
            {
              {
                hourly: "Hourly",
                daily: "Daily",
                weekly: "Weekly",
                custom: "Custom cron",
                webhook: "Webhook",
              }[mode]
            }
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hourly">Hourly</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="custom">Custom cron</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
          </SelectContent>
        </Select>

        {mode === "weekly" ? (
          <Select value={weekday} onValueChange={setWeekday}>
            <SelectTrigger className="bg-muted/55 h-10 min-w-36 rounded-xl border-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
              {WEEKDAYS.find((day) => day.value === weekday)?.label}
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((day) => (
                <SelectItem key={day.value} value={day.value}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {mode === "daily" || mode === "weekly" ? (
          <Input
            aria-label="Heartbeat time"
            className="bg-muted/55 h-10 w-32 rounded-xl border-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
            onChange={(event) => setTime(event.target.value)}
            type="time"
            value={time}
          />
        ) : null}
      </div>

      {mode === "custom" ? (
        <div className="mt-3 space-y-1.5">
          <Input
            aria-label="Heartbeat cron expression"
            className="bg-muted/55 rounded-xl border-0 font-mono shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
            onChange={(event) => setCustom(event.target.value)}
            placeholder="0 9 * * 1-5"
            value={custom}
          />
          <p className="text-muted-foreground text-[10px]">
            minute · hour · day of month · month · day of week
          </p>
        </div>
      ) : null}

      {mode !== "webhook" ? (
        <div className="mt-3">
          <Input
            aria-label="Heartbeat timezone"
            className="bg-muted/55 rounded-xl border-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Australia/Brisbane"
            value={timezone}
          />
        </div>
      ) : (
        <div className="bg-muted/35 mt-3 rounded-xl px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
          <p className="text-xs font-medium">Local webhook</p>
          <p className="text-muted-foreground mt-1 text-[11px] leading-4">
            The URL works for services that can reach this Mac. Generating a new
            URL invalidates the previous one.
          </p>
          {webhookUrl ? (
            <div className="mt-3 flex items-center gap-2">
              <code className="bg-background/70 min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-[10px]">
                {webhookUrl}
              </code>
              <Button
                aria-label="Copy webhook URL"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  toast.success("Webhook URL copied");
                }}
                size="icon"
                variant="outline"
              >
                <Copy size={13} />
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button
          disabled={Boolean(disabled) || saving || running}
          onClick={() => void runNow()}
          variant="outline"
        >
          {running ? "Starting…" : "Run now"}
        </Button>
        <Button
          disabled={Boolean(disabled) || saving || !valid}
          onClick={() => void save()}
        >
          {mode === "webhook" ? "Save and generate URL" : "Save heartbeat"}
        </Button>
      </div>
      {runError ? (
        <p className="text-destructive mt-2 text-xs">{runError}</p>
      ) : null}
    </div>
  );
}
