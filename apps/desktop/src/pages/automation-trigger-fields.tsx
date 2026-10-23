import type { ReactNode } from "react";
import { CalendarClock, CalendarDays, Webhook, Zap } from "lucide-react";

import type { RelayClient } from "@chief/relay-client";
import { cn } from "@chief/ui/lib/utils";

import type { AutomationDraft } from "./automation-draft";
import type { ScheduleFields, ScheduleFrequency } from "./schedule-editor";
import {
  controlClass,
  Field,
  Panel,
  PanelRow,
  PanelSection,
  Segmented,
} from "./automation-panel";
import { WebhookFields } from "./automation-webhook-fields";
import { cronFromFields, friendlySchedule } from "./schedule-editor";

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One line that says when the automation starts. */
export function triggerSummary(draft: AutomationDraft) {
  if (draft.mode === "webhook") return "When a webhook arrives";
  if (draft.mode === "once")
    return draft.once
      ? new Date(draft.once).toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Pick a date and time";
  if (draft.fields.frequency === "custom")
    return draft.fields.custom.trim() || "Write a cron expression";
  return friendlySchedule({
    cron: cronFromFields(draft.fields),
    timezone: draft.timezone,
    triggerMode: "cron",
  });
}

/** The next few runs of a simple rhythm, in this computer's timezone. */
function nextRuns(fields: ScheduleFields, count = 3) {
  if (fields.frequency === "custom") return [];
  const [hour = 9, minute = 0] = fields.time.split(":").map(Number);
  const now = new Date();
  const runs: Date[] = [];
  for (let offset = 0; runs.length < count && offset < 400; offset += 1) {
    const day = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      hour,
      minute,
    );
    const weekday = day.getDay();
    if (
      day <= now ||
      (fields.frequency === "weekdays" && (weekday === 0 || weekday === 6)) ||
      (fields.frequency === "weekly" && String(weekday) !== fields.weekday) ||
      (fields.frequency === "monthly" &&
        day.getDate() !== Number(fields.dayOfMonth))
    )
      continue;
    runs.push(day);
  }
  return runs;
}

const frequencies: readonly { value: ScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Cron" },
];

const dayLetters = ["S", "M", "T", "W", "T", "F", "S"];
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function Chip({
  active,
  children,
  onClick,
  label,
  className,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:text-foreground bg-foreground/[0.045] h-7 rounded-[6px] px-2.5 text-[11px] font-medium transition-colors",
        active &&
          "bg-foreground text-background hover:text-background dark:bg-white dark:text-black",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Preview({ draft }: { draft: AutomationDraft }) {
  const runs =
    draft.mode === "cron" && draft.timezone === localZone
      ? nextRuns(draft.fields)
      : [];
  return (
    <div className="bg-foreground/[0.03] rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
      <p className="text-[13px] leading-5 font-medium tracking-[-0.01em]">
        {triggerSummary(draft)}
      </p>
      {runs.length ? (
        <ol className="mt-2 space-y-1">
          {runs.map((run, index) => (
            <li
              key={run.getTime()}
              className="text-muted-foreground flex items-center gap-2 text-[11px] tabular-nums"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  index === 0 ? "bg-emerald-500" : "bg-foreground/15",
                )}
              />
              {run.toLocaleString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              {index === 0 ? (
                <span className="text-foreground/70 ml-auto">Next</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : draft.mode === "cron" ? (
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          {draft.timezone.replaceAll("_", " ")} time
        </p>
      ) : null}
    </div>
  );
}

/** When an automation runs: a rhythm, a single moment, or a webhook. */
export function TriggerPanel({
  client,
  draft,
  onChange,
  onClose,
}: {
  client: RelayClient | null | undefined;
  draft: AutomationDraft;
  onChange: (patch: Partial<AutomationDraft>) => void;
  onClose: () => void;
}) {
  const { fields } = draft;
  const patchFields = (patch: Partial<ScheduleFields>) =>
    onChange({ fields: { ...fields, ...patch } });
  return (
    <Panel
      icon={<Zap size={15} className="text-muted-foreground" />}
      title="Trigger"
      onClose={onClose}
    >
      <PanelSection>
        <Segmented
          label="Starts"
          value={draft.mode}
          onChange={(mode) => onChange({ mode })}
          options={[
            {
              value: "cron",
              label: "Repeat",
              icon: <CalendarClock size={12} />,
            },
            { value: "once", label: "Once", icon: <CalendarDays size={12} /> },
            { value: "webhook", label: "Webhook", icon: <Webhook size={12} /> },
          ]}
        />
        <Preview draft={draft} />
      </PanelSection>
      {draft.mode === "cron" ? (
        <PanelSection title="Repeat">
          <Segmented
            label="Repeats"
            value={fields.frequency}
            onChange={(frequency) => patchFields({ frequency })}
            options={frequencies}
          />
          {fields.frequency === "custom" ? (
            <Field
              label="Cron expression"
              hint="minute · hour · day · month · weekday"
            >
              <input
                aria-label="Cron expression"
                value={fields.custom}
                spellCheck={false}
                onChange={(event) =>
                  patchFields({ custom: event.target.value })
                }
                placeholder="0 9 * * 1-5"
                className={cn(controlClass, "font-mono")}
              />
            </Field>
          ) : (
            <div className="space-y-1.5 pt-1">
              {fields.frequency === "weekly" ? (
                <PanelRow label="On">
                  <div className="flex justify-between">
                    {dayLetters.map((letter, index) => (
                      <Chip
                        key={dayNames[index]}
                        label={dayNames[index]}
                        active={fields.weekday === String(index)}
                        onClick={() => patchFields({ weekday: String(index) })}
                        className="w-7 px-0"
                      >
                        {letter}
                      </Chip>
                    ))}
                  </div>
                </PanelRow>
              ) : fields.frequency === "monthly" ? (
                <PanelRow label="Day">
                  <input
                    aria-label="Day of month"
                    type="number"
                    min={1}
                    max={31}
                    value={fields.dayOfMonth}
                    onChange={(event) =>
                      patchFields({ dayOfMonth: event.target.value })
                    }
                    className={controlClass}
                  />
                </PanelRow>
              ) : null}
              <PanelRow label="At">
                <input
                  aria-label="Time"
                  type="time"
                  value={fields.time}
                  onChange={(event) =>
                    patchFields({ time: event.target.value })
                  }
                  className={cn(controlClass, "tabular-nums")}
                />
              </PanelRow>
            </div>
          )}
          <PanelRow label="Timezone">
            <input
              aria-label="Timezone"
              value={draft.timezone}
              spellCheck={false}
              onChange={(event) => onChange({ timezone: event.target.value })}
              className={controlClass}
            />
          </PanelRow>
        </PanelSection>
      ) : draft.mode === "once" ? (
        <PanelSection title="Runs on">
          <input
            aria-label="Date and time"
            type="datetime-local"
            value={draft.once}
            onChange={(event) => onChange({ once: event.target.value })}
            className={controlClass}
          />
        </PanelSection>
      ) : (
        <WebhookFields client={client} automationId={draft.id} />
      )}
    </Panel>
  );
}
