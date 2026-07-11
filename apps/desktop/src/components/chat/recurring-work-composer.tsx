import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@marketer/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { cn } from "@marketer/ui/lib/utils";

/**
 * Guided setup for recurring agent work: pick what the team should own and
 * when it should run, and the composer writes the brief into the message box
 * below — the user reads it, adjusts anything, and sends. Presets exist to
 * teach what proactive agents are good at, not to constrain.
 */
interface Preset {
  id: string;
  label: string;
  description: string;
  task: string;
}

const ONE_OFF_PRESETS: Preset[] = [
  {
    id: "analytics-snapshot",
    label: "Analytics snapshot",
    description: "How the numbers looked on this day, with context.",
    task: "Pull an analytics snapshot for this day and explain what stands out.",
  },
  {
    id: "draft-post",
    label: "Draft a post",
    description: "A post drafted for this date's moment or announcement.",
    task: "Draft a post for this date and save it to the schedule for my review.",
  },
  {
    id: "campaign-check",
    label: "Campaign check",
    description: "A one-time look at how campaigns are tracking.",
    task: "Check how our campaigns are tracking and flag anything worth acting on.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Describe the one-off task in your own words.",
    task: "",
  },
];

const PRESETS: Preset[] = [
  {
    id: "growth-brief",
    label: "Growth brief",
    description: "What changed in your numbers, why, and one action each.",
    task: "Compile a growth brief from our connected analytics: what changed, why, and one action per insight.",
  },
  {
    id: "prospect-scan",
    label: "Prospect scan",
    description: "New people and conversations worth a considered reply.",
    task: "Find new prospects and conversations worth a considered reply, and save the good ones to the workspace.",
  },
  {
    id: "content-drafts",
    label: "Content drafts",
    description: "Posts drafted from your recent analytics and trends.",
    task: "Draft next period's posts from our recent analytics and trends, and schedule them as drafts for my review.",
  },
  {
    id: "competitor-watch",
    label: "Competitor watch",
    description: "What competitors shipped or published, when it matters.",
    task: "Check what our competitors shipped or published and summarize anything worth reacting to.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Describe the recurring work in your own words.",
    task: "",
  },
];

type Frequency = "daily" | "weekdays" | "weekly" | "monthly";

const FREQUENCIES: Array<{ value: Frequency; label: string }> = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const WEEKDAYS = [
  { value: "Monday", label: "Monday" },
  { value: "Tuesday", label: "Tuesday" },
  { value: "Wednesday", label: "Wednesday" },
  { value: "Thursday", label: "Thursday" },
  { value: "Friday", label: "Friday" },
  { value: "Saturday", label: "Saturday" },
  { value: "Sunday", label: "Sunday" },
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

export function RecurringWorkComposer({
  mode = "recurring",
  date,
  onCompose,
  onDismiss,
}: {
  mode?: "recurring" | "one-off";
  /** Prefilled date (YYYY-MM-DD) for one-off tasks from the calendar. */
  date?: string;
  onCompose: (text: string) => void;
  onDismiss: () => void;
}) {
  const oneOff = mode === "one-off";
  const presets = oneOff ? ONE_OFF_PRESETS : PRESETS;
  const [presetId, setPresetId] = useState(
    oneOff ? "analytics-snapshot" : "growth-brief",
  );
  const [onDate, setOnDate] = useState(
    date ?? new Date().toISOString().slice(0, 10),
  );
  const [customTask, setCustomTask] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [weekday, setWeekday] = useState("Monday");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [time, setTime] = useState("09:00");

  const preset = presets.find((item) => item.id === presetId) ?? presets[0]!;
  const task = presetId === "custom" ? customTask.trim() : preset.task;

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const text = task
      ? oneOff
        ? `Schedule a one-off task for ${new Date(`${onDate}T00:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} at ${timePhrase(time)} (${timezone}): ${task} It runs once on that date only. Configure everything else yourself and create one narrow approval for me to review in Schedule.`
        : `Set up recurring work for me: ${task} Run it ${frequencyPhrase(frequency, weekday, dayOfMonth)} at ${timePhrase(time)} (${timezone}). Configure everything else yourself and create one narrow approval for me to review in Schedule.`
      : "";
    onCompose(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, frequency, weekday, dayOfMonth, time, onDate, oneOff]);

  return (
    <div className="border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {oneOff ? "Schedule a one-off task" : "Schedule new work"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {oneOff
              ? "Pick what should happen that day; the brief writes itself below."
              : "Pick what your team should own; the brief writes itself below."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border p-0.5 w-fit">
        {presets.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPresetId(item.id)}
            className={cn(
              "px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
              presetId === item.id && "bg-accent text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{preset.description}</p>
      {presetId === "custom" ? (
        <Input
          value={customTask}
          onChange={(event) => setCustomTask(event.target.value)}
          placeholder="What should the agent do each time?"
          className="mt-2 h-8 text-sm"
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {oneOff ? (
          <Input
            type="date"
            value={onDate}
            onChange={(event) => setOnDate(event.target.value)}
            className="h-8 w-36 text-xs"
          />
        ) : (
        <Select
          value={frequency}
          onValueChange={(value) => setFrequency(value as Frequency)}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
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
        )}
        {!oneOff && frequency === "weekly" ? (
          <Select value={weekday} onValueChange={setWeekday}>
            <SelectTrigger className="h-8 w-32 text-xs">
              {weekday}
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {!oneOff && frequency === "monthly" ? (
          <Input
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(event.target.value)}
            className="h-8 w-16 text-xs"
            placeholder="Day"
          />
        ) : null}
        <Input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="h-8 w-28 text-xs"
        />
      </div>
    </div>
  );
}
