import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@chief/ui/lib/utils";

import type { useDashboardController } from "./use-dashboard-controller";
import { AnalyticsChart, Trend } from "../components/overview-presentation";

type DashboardController = ReturnType<typeof useDashboardController>;

type DashboardSidePanelsProps = Pick<
  DashboardController,
  | "activeAnalyticsSlide"
  | "agentWorkTimeline"
  | "analyticsIndex"
  | "analyticsSlides"
  | "moveAnalytics"
  | "navigate"
  | "prefersReducedMotion"
  | "selectAnalytics"
  | "setAnalyticsPaused"
  | "workspaceData"
> & {
  agentName: (agentId: string) => string;
  surfaceClassName: string;
};

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function scheduleDate(timestamp: number, timezone: string, now: number) {
  const date = new Date(timestamp);
  const today = dayKey(new Date(now), timezone);
  const tomorrow = dayKey(new Date(now + 86_400_000), timezone);
  const target = dayKey(date, timezone);
  const day =
    target === today
      ? "Today"
      : target === tomorrow
        ? "Tomorrow"
        : new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            timeZone: timezone,
          }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
  return { day, time };
}

function workState(item: DashboardController["agentWorkTimeline"][number]) {
  if (item.kind === "upcoming") {
    return item.onceAt === undefined ? "Scheduled" : "One-time task";
  }
  if (item.status === "completed") return "Complete";
  if (item.status === "failed") return "Needs attention";
  if (item.status === "waiting") return "Waiting for input";
  if (item.childId) return "Specialist working";
  if (item.taskCount) {
    return `${item.taskCount} ${item.taskCount === 1 ? "task" : "tasks"} in progress`;
  }
  return "Working now";
}

export function DashboardSidePanels({
  activeAnalyticsSlide,
  agentName,
  agentWorkTimeline,
  analyticsIndex,
  analyticsSlides,
  moveAnalytics,
  navigate,
  prefersReducedMotion,
  selectAnalytics,
  setAnalyticsPaused,
  surfaceClassName,
  workspaceData,
}: DashboardSidePanelsProps) {
  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[minmax(210px,0.85fr)_minmax(270px,1.15fr)] gap-2.5 max-[760px]:grid-cols-2 max-[760px]:grid-rows-none">
      <section
        aria-label="Workspace analytics"
        className={cn(surfaceClassName, "relative min-w-0 overflow-visible")}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setAnalyticsPaused(false);
          }
        }}
        onFocusCapture={() => setAnalyticsPaused(true)}
        onMouseEnter={() => setAnalyticsPaused(true)}
        onMouseLeave={() => setAnalyticsPaused(false)}
      >
        <AnimatePresence initial={false} mode="wait">
          {activeAnalyticsSlide ? (
            <motion.article
              animate={{ opacity: 1, x: 0 }}
              className="absolute inset-0 cursor-pointer p-5 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
              exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -8 }}
              initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 8 }}
              key={activeAnalyticsSlide.id}
              onClick={() => navigate("/analytics")}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                void navigate("/analytics");
              }}
              role="link"
              tabIndex={0}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.28,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <h2 className="mt-10 max-w-[340px] text-[clamp(17px,1.8vw,23px)] leading-[1.12] font-normal tracking-[-0.025em]">
                {activeAnalyticsSlide.title}
              </h2>
              <div className="mt-4 flex items-baseline gap-2">
                <strong className="text-[22px] font-medium">
                  {activeAnalyticsSlide.value}
                </strong>
                <span className="text-muted-foreground text-[10px]">
                  {activeAnalyticsSlide.label}
                </span>
                <Trend value={activeAnalyticsSlide.trend} />
              </div>
              {activeAnalyticsSlide.points ? (
                <AnalyticsChart
                  label={activeAnalyticsSlide.label}
                  points={activeAnalyticsSlide.points}
                  reduceMotion={Boolean(prefersReducedMotion)}
                />
              ) : null}
            </motion.article>
          ) : null}
        </AnimatePresence>
        <div className="absolute right-3 bottom-2 z-[3] flex items-center gap-2">
          <button
            aria-label="Previous analytics card"
            onClick={() => moveAnalytics(-1)}
            type="button"
            className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
          >
            <ChevronLeft size={14} />
          </button>
          <span aria-label="Analytics cards" className="flex gap-1">
            {analyticsSlides.map((slide, index) => (
              <button
                aria-label={`Show ${slide.label}`}
                aria-pressed={index === analyticsIndex}
                key={slide.id}
                onClick={() => selectAnalytics(index)}
                type="button"
                className="grid h-3 w-3 place-items-center"
              >
                <i
                  className={cn(
                    "bg-border block h-0.5 w-3 rounded-full",
                    index === analyticsIndex && "bg-foreground",
                  )}
                />
              </button>
            ))}
          </span>
          <button
            aria-label="Next analytics card"
            onClick={() => moveAnalytics(1)}
            type="button"
            className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </section>

      <section
        className={cn(
          surfaceClassName,
          "relative flex min-h-0 min-w-0 flex-col overflow-hidden p-4",
        )}
        aria-label="Upcoming work"
      >
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] leading-4 font-semibold">
              Upcoming work
            </h2>
            <p className="text-muted-foreground mt-0.5 truncate text-[11px] leading-4 font-normal">
              Scheduled and in progress
            </p>
          </div>
          <button
            aria-label="Open schedule"
            className="border-border/60 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground grid size-8 shrink-0 place-items-center rounded-lg border transition-colors"
            onClick={() => navigate("/schedule")}
            title="Open schedule"
            type="button"
          >
            <CalendarDays size={14} />
          </button>
        </header>
        <div className="mt-2 min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto overscroll-contain pr-1">
          {agentWorkTimeline.length > 0 ? (
            <div className="relative py-1">
              {agentWorkTimeline.map((item, index) => {
                const when = scheduleDate(
                  item.timestamp,
                  item.timezone,
                  workspaceData.now,
                );
                return (
                  <button
                    key={item.id}
                    onClick={() =>
                      navigate(
                        item.kind === "active"
                          ? item.parentId
                            ? `/conversations?chat=${encodeURIComponent(item.parentId)}${item.childId ? `&child=${encodeURIComponent(item.childId)}` : ""}`
                            : "/conversations"
                          : "/schedule",
                      )
                    }
                    type="button"
                    className="hover:bg-foreground/[0.025] grid min-h-12 w-full grid-cols-[52px_20px_minmax(0,1fr)_12px] items-center gap-x-0 rounded-lg px-1 text-left transition-colors"
                  >
                    <time className="grid min-w-0 gap-0.5">
                      <strong className="text-foreground/85 text-[11px] leading-4 font-semibold">
                        {item.kind === "active" ? "Now" : when.day}
                      </strong>
                      <span className="text-muted-foreground text-[11px] leading-4 font-normal">
                        {when.time}
                      </span>
                    </time>
                    <span
                      className={cn(
                        "before:bg-foreground/[0.1] relative grid h-full min-h-12 place-items-center before:absolute before:left-[calc(50%-0.5px)] before:w-px",
                        index === 0 ? "before:top-1/2" : "before:top-0",
                        index === agentWorkTimeline.length - 1
                          ? "before:bottom-1/2"
                          : "before:bottom-0",
                      )}
                    >
                      <i
                        className={cn(
                          "bg-muted-foreground/60 relative z-[1] grid size-2 place-items-center rounded-full shadow-[0_0_0_3px_var(--card)]",
                          (item.kind === "upcoming" ||
                            item.status === "completed" ||
                            item.status === "waiting") &&
                            "bg-emerald-500",
                          item.status === "failed" && "bg-red-500",
                          item.kind === "active" &&
                            item.status === "running" &&
                            "bg-card text-foreground size-4",
                        )}
                      >
                        {item.kind === "active" && item.status === "running" ? (
                          <LoaderCircle
                            aria-hidden
                            className="animate-spin"
                            size={10}
                          />
                        ) : null}
                      </i>
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[11px] leading-4 font-semibold">
                        {item.title}
                      </strong>
                      <small className="text-muted-foreground truncate text-[11px] leading-4 font-normal">
                        {workState(item)} · {agentName(item.agentId)}
                      </small>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="text-muted-foreground/60"
                      size={10}
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground flex min-h-36 items-center justify-center text-center">
              <span className="grid gap-1">
                <strong className="text-foreground text-[11px] font-medium">
                  No upcoming work
                </strong>
                <small className="text-[10px]">Your schedule is clear.</small>
              </span>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
