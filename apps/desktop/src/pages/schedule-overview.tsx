import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Search,
  Sparkles,
} from "lucide-react";

import type {
  RecurringWorkRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import type { ScheduledDraft } from "./schedule-calendar-core";
import { agentName } from "./schedule-calendar-core";
import { friendlySchedule } from "./schedule-editor";

type WorkFilter =
  "all" | "running" | "review" | "upcoming" | "paused" | "issues";
const filters: { id: WorkFilter; label: string }[] = [
  { id: "all", label: "All work" },
  { id: "running", label: "Running" },
  { id: "review", label: "Needs review" },
  { id: "upcoming", label: "Upcoming" },
  { id: "paused", label: "Paused" },
  { id: "issues", label: "Issues" },
];
const suggestions = [
  {
    title: "Build a marketing rhythm",
    description: "Research customers, draft campaigns, and measure what works.",
    prompt:
      "Help me set up recurring marketing work for this business. Ask about my customers, current channels, and a measurable outcome first. Propose a focused weekly schedule for my approval. Keep publishing and outreach subject to my approval.",
  },
  {
    title: "Keep engineering moving",
    description:
      "Review progress, clear blockers, and plan the next useful change.",
    prompt:
      "Help me set up an engineering cadence for this business. Ask which repository and product goal to focus on, then propose a daily progress review and one measurable improvement for my approval.",
  },
];

function workFilter(work: RecurringWorkRecord): WorkFilter {
  if (work.status === "draft" || work.status === "needs_approval")
    return "review";
  if (work.status === "error") return "issues";
  if (work.status === "paused") return "paused";
  return "upcoming";
}

function nextRunLabel(work: RecurringWorkRecord, now: number) {
  if (work.status === "paused") return "No runs scheduled";
  if (work.status === "draft" || work.status === "needs_approval")
    return "Waiting for your approval";
  if (work.status === "error") return "Needs attention before continuing";
  const timestamp = work.nextAt ?? work.upcomingRuns?.[0];
  if (timestamp === undefined) return "Waiting for the next run";
  if (timestamp <= now) return "Due now";
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return `${sameDay ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function ScheduleOverview({
  work,
  drafts,
  activity,
  now,
  loading,
  onOpenWork,
  onEditWork,
  onTogglePause,
  onRunWork,
  onOpenDraft,
  onOpenActivity,
  onCreate,
}: {
  work: RecurringWorkRecord[];
  drafts: ScheduledDraft[];
  activity: SessionRecord[];
  now: number;
  loading: boolean;
  onOpenWork: (work: RecurringWorkRecord) => void;
  onEditWork: (work: RecurringWorkRecord) => void;
  onTogglePause: (work: RecurringWorkRecord) => void;
  onRunWork: (work: RecurringWorkRecord) => void;
  onOpenDraft: (draft: ScheduledDraft) => void;
  onOpenActivity: (activity: SessionRecord) => void;
  onCreate: (prompt?: string) => void;
}) {
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [query, setQuery] = useState("");
  const running = activity.filter(
    (session) => session.status === "running" || session.status === "waiting",
  );
  const failedRuns = activity.filter((session) => session.status === "failed");
  const pendingDrafts = drafts.filter((draft) => draft.status !== "published");
  const counts = {
    all:
      work.length + pendingDrafts.length + running.length + failedRuns.length,
    running: running.length,
    review:
      work.filter((item) => workFilter(item) === "review").length +
      pendingDrafts.filter((draft) => draft.status !== "scheduled").length,
    upcoming:
      work.filter((item) => item.status === "active").length +
      pendingDrafts.filter((draft) => draft.status === "scheduled").length,
    paused: work.filter((item) => item.status === "paused").length,
    issues:
      work.filter((item) => item.status === "error").length + failedRuns.length,
  };
  const matches = (text: string) =>
    text.toLowerCase().includes(query.trim().toLowerCase());
  const visibleWork = work
    .filter(
      (item) =>
        (filter === "all" || workFilter(item) === filter) &&
        matches(
          `${item.title} ${agentName(item.agentId)} ${item.instructions}`,
        ),
    )
    .sort((left, right) => {
      const priority = {
        review: 0,
        issues: 1,
        running: 2,
        upcoming: 3,
        paused: 4,
        all: 5,
      };
      return (
        priority[workFilter(left)] - priority[workFilter(right)] ||
        (left.nextAt ?? Infinity) - (right.nextAt ?? Infinity) ||
        left.title.localeCompare(right.title)
      );
    });
  const visibleDrafts = pendingDrafts.filter(
    (draft) =>
      (filter === "all" ||
        (draft.status === "scheduled"
          ? filter === "upcoming"
          : filter === "review")) &&
      matches(`${draft.title} ${draft.platform}`),
  );
  const visibleRuns = [...running, ...failedRuns].filter(
    (session) =>
      (filter === "all" ||
        (session.status === "failed"
          ? filter === "issues"
          : filter === "running")) &&
      matches(`${session.title} ${agentName(session.agent)}`),
  );
  const isEmpty = counts.all === 0;
  const noResults =
    visibleWork.length + visibleDrafts.length + visibleRuns.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              id: "running",
              label: "Running now",
              value: counts.running,
              icon: LoaderCircle,
              detail: "Work your agents are handling",
            },
            {
              id: "review",
              label: "Needs your review",
              value: counts.review,
              icon: Sparkles,
              detail: "Approve the plan before it starts",
            },
            {
              id: "upcoming",
              label: "On the schedule",
              value: counts.upcoming,
              icon: CalendarClock,
              detail: "Active routines and planned posts",
            },
            {
              id: "issues",
              label: "Needs attention",
              value: counts.issues,
              icon: CircleAlert,
              detail: "Work that could not continue",
            },
          ].map(({ id, label, value, icon: Icon, detail }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                const option = filters.find((item) => item.id === id);
                if (option) setFilter(option.id);
              }}
              className={cn(
                "bg-card/50 hover:bg-accent/60 rounded-xl border p-4 text-left transition-colors",
                filter === id ? "border-foreground/35" : "border-border/55",
              )}
            >
              <span className="text-muted-foreground flex items-center gap-2 text-xs">
                <Icon size={14} />
                {label}
              </span>
              <span className="mt-3 block text-3xl font-medium tracking-tight tabular-nums">
                {loading && isEmpty ? "·" : value}
              </span>
              <span className="text-muted-foreground mt-1 block text-[11px]">
                {detail}
              </span>
            </button>
          ))}
        </div>
        {loading && isEmpty ? (
          <div
            role="status"
            className="text-muted-foreground flex items-center justify-center gap-2 py-20 text-sm"
          >
            <LoaderCircle size={16} className="animate-spin" />
            Loading your schedule…
          </div>
        ) : isEmpty ? (
          <div className="rounded-2xl border border-dashed p-8 sm:p-10">
            <span className="bg-muted mb-5 flex size-11 items-center justify-center rounded-xl">
              <CalendarClock size={21} />
            </span>
            <h2 className="text-xl font-medium tracking-tight">
              Give your team a rhythm
            </h2>
            <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-6">
              Decide what your business needs to make progress. Chief can turn
              it into recurring work, with a clear owner, a time to run, and
              results in your channels.
            </p>
            <Button className="mt-5" onClick={() => onCreate()}>
              Plan your first schedule
              <ArrowRight size={14} />
            </Button>
            <div className="mt-9 grid gap-3 sm:grid-cols-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.title}
                  type="button"
                  onClick={() => onCreate(suggestion.prompt)}
                  className="hover:bg-accent rounded-xl border p-4 text-left transition-colors"
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {suggestion.title}
                    <ArrowRight size={14} className="text-muted-foreground" />
                  </span>
                  <span className="text-muted-foreground mt-1.5 block text-xs leading-5">
                    {suggestion.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex flex-wrap gap-1"
                aria-label="Filter scheduled work"
              >
                {filters.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={filter === option.id}
                    onClick={() => setFilter(option.id)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                      filter === option.id
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {option.label}
                    <span className="ml-1.5 tabular-nums opacity-65">
                      {counts[option.id]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="relative w-48">
                <Search
                  size={13}
                  className="text-muted-foreground absolute top-2.5 left-2.5"
                />
                <Input
                  aria-label="Search scheduled work"
                  placeholder="Search work…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="border-border/65 overflow-hidden rounded-xl border">
              {visibleRuns.map((session) => (
                <button
                  key={`run-${session.id}`}
                  type="button"
                  onClick={() => onOpenActivity(session)}
                  className="hover:bg-accent/45 border-border/50 flex w-full items-center gap-4 border-b px-5 py-4 text-left last:border-b-0"
                >
                  {session.status === "failed" ? (
                    <CircleAlert size={17} className="shrink-0 text-red-600" />
                  ) : (
                    <LoaderCircle
                      size={17}
                      className="shrink-0 animate-spin text-emerald-600"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {session.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {agentName(session.agent)} ·{" "}
                      {session.status === "failed"
                        ? "Failed"
                        : session.status === "waiting"
                          ? "Waiting for input"
                          : "Working now"}
                    </span>
                    {session.status === "failed" && session.error ? (
                      <span className="mt-1.5 line-clamp-2 text-xs text-red-600 dark:text-red-400">
                        {session.error}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    View activity
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
              {visibleWork.map((item) => (
                <ScheduleWorkRow
                  key={item.id}
                  work={item}
                  now={now}
                  onOpen={() => onOpenWork(item)}
                  onEdit={() => onEditWork(item)}
                  onTogglePause={() => onTogglePause(item)}
                  onRun={() => onRunWork(item)}
                />
              ))}
              {visibleDrafts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => onOpenDraft(draft)}
                  className="hover:bg-accent/45 border-border/50 flex w-full items-center gap-4 border-b px-5 py-4 text-left last:border-b-0"
                >
                  <Pencil
                    size={17}
                    className="text-muted-foreground shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {draft.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {draft.platform} ·{" "}
                      {draft.scheduledFor
                        ? new Date(draft.scheduledFor).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Choose a publishing time"}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {draft.status === "scheduled"
                      ? "Scheduled post"
                      : "Review draft"}
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
              {noResults ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-sm font-medium">
                    {query
                      ? "No matching work"
                      : `No ${filters.find((item) => item.id === filter)?.label.toLowerCase()} work`}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {query
                      ? "Try another title or agent name."
                      : "You can keep working. New items will appear here."}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Show all work
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-4 text-[11px]">
              Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
              Agents post each run in its channel.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleWorkRow({
  work,
  now,
  onOpen,
  onEdit,
  onTogglePause,
  onRun,
}: {
  work: RecurringWorkRecord;
  now: number;
  onOpen: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onRun: () => void;
}) {
  const status = workFilter(work);
  const needsReview = status === "review";
  const Icon = needsReview
    ? Sparkles
    : status === "issues"
      ? CircleAlert
      : status === "paused"
        ? Pause
        : Clock3;
  return (
    <div className="group border-border/50 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-4 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-48 flex-1 items-start gap-4 text-left"
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            needsReview
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : status === "issues"
                ? "bg-red-500/10 text-red-600"
                : "bg-muted/65 text-muted-foreground",
          )}
        >
          <Icon size={16} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium underline-offset-4 group-hover:underline">
            {work.title}
          </span>
          <span className="text-muted-foreground mt-1 block text-xs">
            {agentName(work.agentId)} · {friendlySchedule(work)}
          </span>
          {work.lastSummary && status === "issues" ? (
            <span className="mt-1.5 line-clamp-2 text-xs text-red-600 dark:text-red-400">
              {work.lastSummary}
            </span>
          ) : null}
        </span>
      </button>
      <div className="ml-12 flex min-w-36 flex-1 flex-col gap-1 sm:ml-0 sm:max-w-48">
        <span
          className={cn(
            "text-xs",
            needsReview
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          {nextRunLabel(work, now)}
        </span>
        <span className="text-muted-foreground/75 text-[10px]">
          {work.onceAt === undefined ? "Recurring" : "One time"} ·{" "}
          {work.timezone}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {needsReview ? (
          <Button size="sm" onClick={onOpen}>
            Review
            <ArrowRight size={13} />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Run ${work.title} now`}
              title="Run now"
              onClick={onRun}
            >
              <Play size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onTogglePause}>
              {work.status === "active" ? "Pause" : "Resume"}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${work.title}`}
          title="Edit schedule"
          onClick={onEdit}
        >
          <Pencil size={14} />
        </Button>
      </div>
    </div>
  );
}
