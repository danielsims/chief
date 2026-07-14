import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Eye, X } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import type {
  IntegrationDependency,
  PlaybookCategory,
} from "../../lib/playbooks";
import {
  PLAYBOOK_CATEGORIES,
  playbookRunPrompt,
  PLAYBOOKS,
} from "../../lib/playbooks";
import { IntegrationAvatarStack } from "../integrations/integration-avatar-stack";
import { PlaybookDocument } from "../playbooks/playbook-document";

interface Preset {
  id: string;
  label: string;
  description: string;
  task: string;
  categories?: PlaybookCategory[];
  integrations?: IntegrationDependency[];
}

const ONE_OFF_PRESETS: Preset[] = [
  {
    id: "analytics-snapshot",
    label: "Analytics report",
    description: "Explain changes and next steps.",
    task: "Pull an analytics snapshot for this day and explain what changed, why it matters, and what to do next.",
  },
  {
    id: "draft-post",
    label: "Draft content",
    description: "Prepare a post for review.",
    task: "Draft a post for this date and save it to the schedule for my review.",
  },
  {
    id: "campaign-check",
    label: "Campaign check",
    description: "Flag spend or performance issues.",
    task: "Check how our campaigns are tracking and flag anything worth acting on.",
  },
  {
    id: "custom",
    label: "Custom task",
    description: "Write your own instructions.",
    task: "",
  },
];

const RECURRING_PRESETS: Preset[] = [
  ...PLAYBOOKS.map((playbook) => ({
    id: playbook.id,
    label: playbook.title,
    description: playbook.summary,
    task: playbookRunPrompt(playbook),
    categories: playbook.categories,
    integrations: playbook.integrations,
  })),
  {
    id: "custom",
    label: "Custom task",
    description: "Write your own instructions.",
    task: "",
    categories: PLAYBOOK_CATEGORIES,
  },
];

type Frequency = "daily" | "weekdays" | "weekly" | "monthly";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function frequencyPhrase(
  frequency: Frequency,
  weekday: string,
  dayOfMonth: string,
) {
  if (frequency === "daily") return "every day";
  if (frequency === "weekdays") return "every weekday";
  if (frequency === "weekly") return `every ${weekday}`;
  return `on day ${dayOfMonth} of each month`;
}

function timePhrase(time: string) {
  const [hour = "9", minute = "0"] = time.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextScheduleDefaults() {
  const next = new Date();
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil((next.getMinutes() + 1) / 30) * 30);
  const weekdayIndex = (next.getDay() + 6) % 7;
  return {
    weekday: WEEKDAYS[weekdayIndex]!,
    dayOfMonth: String(next.getDate()),
    time: `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`,
  };
}

export interface SchedulingDraft {
  text: string;
  approveAfterCreation: boolean;
}

export function RecurringWorkComposer({
  mode = "recurring",
  date,
  playbookId,
  onCompose,
  onSubmit,
  onDismiss,
}: {
  mode?: "recurring" | "one-off";
  date?: string;
  playbookId?: string;
  onCompose: (draft: SchedulingDraft) => void;
  onSubmit: () => void;
  onDismiss: () => void;
}) {
  const oneOff = mode === "one-off";
  const presets = oneOff ? ONE_OFF_PRESETS : RECURRING_PRESETS;
  const initialPlaybook = PLAYBOOKS.find(
    (playbook) => !oneOff && playbook.id === playbookId,
  );
  const [category, setCategory] = useState<PlaybookCategory>(
    initialPlaybook?.categories[0] ?? "Find customers",
  );
  const [presetId, setPresetId] = useState(
    oneOff ? "analytics-snapshot" : (initialPlaybook?.id ?? "growth-brief"),
  );
  const [onDate, setOnDate] = useState(date ?? localDateValue());
  const [customTask, setCustomTask] = useState("");
  const [scheduleDefaults] = useState(nextScheduleDefaults);
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [weekday, setWeekday] = useState(scheduleDefaults.weekday);
  const [dayOfMonth, setDayOfMonth] = useState(scheduleDefaults.dayOfMonth);
  const [time, setTime] = useState(scheduleDefaults.time);
  const [approveAfterCreation, setApproveAfterCreation] = useState(false);
  const [viewingPlaybookId, setViewingPlaybookId] = useState<string | null>(
    null,
  );

  const preset = presets.find((item) => item.id === presetId) ?? presets[0]!;
  const task = presetId === "custom" ? customTask.trim() : preset.task;
  const visiblePresets = oneOff
    ? presets
    : presets.filter((item) => item.categories?.includes(category));
  const viewingPlaybook = PLAYBOOKS.find(
    (playbook) => playbook.id === viewingPlaybookId,
  );

  const selectCategory = (next: PlaybookCategory) => {
    setCategory(next);
    const nextPresets = RECURRING_PRESETS.filter((item) =>
      item.categories?.includes(next),
    );
    if (!nextPresets.some((item) => item.id === presetId)) {
      setPresetId(nextPresets[0]!.id);
    }
  };

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const approvalInstruction = approveAfterCreation
      ? "I chose Create as approved in Chief. Propose only the exact tools required; Chief will activate it after creation."
      : "Create one narrow approval for me to review in Schedule.";
    const text = task
      ? oneOff
        ? `Schedule a one-off task for ${new Date(`${onDate}T00:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} at ${timePhrase(time)} (${timezone}): ${task} It runs once on that date only. Set runOnceAt to ${new Date(`${onDate}T${time}:00`).toISOString()}. Configure everything else yourself. ${approvalInstruction}`
        : `Set up recurring work for me: ${task} Run it ${frequencyPhrase(frequency, weekday, dayOfMonth)} at ${timePhrase(time)} (${timezone}). Configure everything else yourself. ${approvalInstruction}`
      : "";
    onCompose({ text, approveAfterCreation });
    // onCompose deliberately mirrors form state into the editable chat draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    task,
    frequency,
    weekday,
    dayOfMonth,
    time,
    onDate,
    oneOff,
    approveAfterCreation,
  ]);

  if (viewingPlaybook) {
    return (
      <div className="bg-card w-full border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setViewingPlaybookId(null)}
              className="text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1.5 text-xs transition-colors"
            >
              <ArrowLeft size={13} />
              Back to playbooks
            </button>
            <p className="font-serif text-2xl">{viewingPlaybook.title}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {viewingPlaybook.summary}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss scheduling form"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground p-1 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-y px-4 py-3">
          <IntegrationAvatarStack
            integrations={viewingPlaybook.integrations}
            max={10}
          />
          <span className="text-muted-foreground text-xs">
            {viewingPlaybook.integrations
              .map((integration) => integration.label)
              .join(", ")}
          </span>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          <PlaybookDocument playbook={viewingPlaybook} compact />
        </div>
        <div className="flex items-center justify-between gap-3 border-t p-4">
          <Button variant="outline" onClick={() => setViewingPlaybookId(null)}>
            Back
          </Button>
          <Button
            onClick={() => {
              setCategory(viewingPlaybook.categories[0]!);
              setPresetId(viewingPlaybook.id);
              setViewingPlaybookId(null);
            }}
          >
            Use this playbook
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card w-full border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-2xl">
            {oneOff ? "Schedule a task" : "Schedule recurring work"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Choose when it runs and what it should do.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss scheduling form"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground p-1 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="mt-4 border-b pb-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays size={14} className="text-muted-foreground" />
          <p className="text-xs font-medium">When should it run?</p>
        </div>
        <div
          className={cn(
            "grid gap-3",
            oneOff ? "sm:grid-cols-2" : "sm:grid-cols-3",
          )}
        >
          {oneOff ? (
            <label className="text-muted-foreground space-y-1.5 text-xs">
              Date
              <Input
                type="date"
                value={onDate}
                onChange={(event) => setOnDate(event.target.value)}
                className="text-foreground h-10 text-sm"
              />
            </label>
          ) : (
            <label className="text-muted-foreground space-y-1.5 text-xs">
              Repeats
              <Select
                value={frequency}
                onValueChange={(value) => setFrequency(value as Frequency)}
              >
                <SelectTrigger className="text-foreground h-10 w-full text-sm">
                  {FREQUENCIES.find((item) => item.value === frequency)?.label}
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          {!oneOff && frequency === "weekly" ? (
            <label className="text-muted-foreground space-y-1.5 text-xs">
              Day
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger className="text-foreground h-10 w-full text-sm">
                  {weekday}
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}

          {!oneOff && frequency === "monthly" ? (
            <label className="text-muted-foreground space-y-1.5 text-xs">
              Day of month
              <Input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value)}
                className="text-foreground h-10 text-sm"
              />
            </label>
          ) : null}

          <label className="text-muted-foreground space-y-1.5 text-xs">
            Time
            <Input
              type="time"
              step={60}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="text-foreground h-10 text-sm"
            />
          </label>
        </div>
      </div>

      <div className="py-4">
        <p className="text-xs font-medium">Choose a playbook</p>
        {!oneOff ? (
          <div className="mt-3 flex gap-4 overflow-x-auto border-b">
            {PLAYBOOK_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectCategory(item)}
                className={cn(
                  "text-muted-foreground hover:text-foreground -mb-px shrink-0 border-b-2 border-transparent pb-2 text-xs transition-colors",
                  category === item && "border-foreground text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3 border">
          {visiblePresets.map((item) => {
            const selected = presetId === item.id;
            const playbook = PLAYBOOKS.find(
              (candidate) => candidate.id === item.id,
            );
            return (
              <div
                key={item.id}
                className={cn(
                  "hover:bg-accent/50 flex w-full items-center justify-between gap-4 border-b px-3 py-2 text-left transition-colors last:border-b-0",
                  selected && "bg-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => setPresetId(item.id)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "border-muted-foreground mt-1.5 size-2 shrink-0 border",
                      selected && "border-foreground bg-foreground",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs leading-4">
                      {item.description}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <IntegrationAvatarStack integrations={item.integrations} />
                  {playbook ? (
                    <button
                      type="button"
                      onClick={() => setViewingPlaybookId(playbook.id)}
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px] transition-colors"
                      aria-label={`View ${playbook.title} details`}
                    >
                      <Eye size={12} />
                      View
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {presetId === "custom" ? (
          <Input
            value={customTask}
            onChange={(event) => setCustomTask(event.target.value)}
            placeholder="Describe the task"
            className="mt-3 h-10 text-sm"
            autoFocus
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-3">
        <label className="flex cursor-pointer items-center gap-2.5">
          <Switch
            checked={approveAfterCreation}
            onCheckedChange={setApproveAfterCreation}
          />
          <span>
            <span className="block text-xs font-medium">
              Create as approved
            </span>
            <span className="text-muted-foreground block text-[10px]">
              Skip the separate approval step
            </span>
          </span>
        </label>
        <Button disabled={!task} onClick={onSubmit}>
          {oneOff ? "Schedule task" : "Schedule work"}
        </Button>
      </div>
    </div>
  );
}
