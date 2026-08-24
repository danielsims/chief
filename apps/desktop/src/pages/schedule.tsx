import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type {
  CalendarView,
  ScheduledDraft,
  ScheduleKind,
} from "./schedule-calendar-core";
import { PageTitle } from "../components/page-title";
import { useAgentConfig } from "../lib/agent-config";
import { useAuth } from "../lib/auth/auth-context";
import { messageBlocks, useChiefChat, useWorkspaceData } from "../lib/runtime";
import { ContinuousMonthView, ScheduleFilters } from "./schedule-calendar";
import {
  addDays,
  addMonths,
  dayKey,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./schedule-calendar-core";
import {
  RecurringWorkApprovalDialog,
  ScheduleEventDetailDialog,
} from "./schedule-dialogs";
import { RecurringWorkEditDialog } from "./schedule-editor";
import { MonthJump, ScheduleInbox } from "./schedule-inbox";
import {
  FocusedCalendarView,
  RecurringWorkContextMenu,
} from "./schedule-timeline";

export function SchedulePage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [now, setNow] = useState(Date.now);
  const currentMonth = useMemo(() => startOfMonth(today), [today]);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<CalendarView>("week");
  const [activeMonth, setActiveMonth] = useState(currentMonth);
  const [monthDirection, setMonthDirection] = useState<1 | -1>(1);
  const [scrollRequest, setScrollRequest] = useState({
    month: currentMonth,
    token: 0,
  });
  const [visibleKinds, setVisibleKinds] = useState<ReadonlySet<ScheduleKind>>(
    () => new Set<ScheduleKind>(["post", "agent-work"]),
  );
  const [approvalWorkId, setApprovalWorkId] = useState<string | null>(null);
  const [detailWorkId, setDetailWorkId] = useState<string | null>(null);
  const [detailDraftId, setDetailDraftId] = useState<string | null>(null);
  const [workMenu, setWorkMenu] = useState<{
    work: RecurringWorkRecord;
    date: Date;
    x: number;
    y: number;
  } | null>(null);
  const [editWorkId, setEditWorkId] = useState<string | null>(null);
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const agentConfig = useAgentConfig();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // Derived from live workspace data so an agent revision streams straight
  // into the open approval card.
  const approvalWork = approvalWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === approvalWorkId) ??
      null)
    : null;
  const detailWork = detailWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === detailWorkId) ??
      null)
    : null;
  const detailDraft = detailDraftId
    ? (workspaceData.drafts.find((draft) => draft.id === detailDraftId) ?? null)
    : null;
  const revisionDriver = agentConfig.forAgent("chief").driver;
  const revisionChat = useChiefChat(approvalWork?.conversationId ?? null);
  const revisionNote = useMemo(() => {
    for (let i = revisionChat.messages.length - 1; i >= 0; i -= 1) {
      const item = revisionChat.messages[i];
      if (!item) continue;
      if (item.role !== "assistant") continue;
      const text = messageBlocks(item)
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(" ")
        .trim();
      if (text) return text;
    }
    return null;
  }, [revisionChat.messages]);
  const openWorkReview = (work: RecurringWorkRecord) => {
    if (work.status === "draft" || work.status === "needs_approval") {
      setApprovalWorkId(work.id);
      return;
    }
    setDetailWorkId(work.id);
  };

  const requestRevision = (feedback: string) => {
    if (!approvalWork) return;
    const draft = {
      id: approvalWork.id,
      agentId: approvalWork.agentId,
      title: approvalWork.title,
      cron: approvalWork.cron,
      timezone: approvalWork.timezone,
      onceAt: approvalWork.onceAt,
      instructions: approvalWork.instructions,
      approvalSummary: approvalWork.approvalSummary,
      proposedToolPatterns: approvalWork.proposedToolPatterns,
    };
    void revisionChat.sendMessage({
      text: [
        "The user is reviewing a draft recurring-work approval and asked for a change before approving.",
        `Current draft (JSON): ${JSON.stringify(draft)}`,
        `Feedback: "${feedback}"`,
        `Right now it is ${new Date().toString()}.`,
        "Apply the feedback by calling the recurringWorkPropose local tool with the SAME id and ALL fields (id, title, agentId, cron, timezone, onceAt when present, instructions, approvalSummary, proposedToolPatterns), changing only what the feedback requires. Then reply with one short sentence stating exactly what changed. Do not ask questions.",
      ].join("\n"),
    });
  };

  const workDateKeyIn = (timestamp: number, timezone: string) => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp));
    } catch {
      return dayKey(new Date(timestamp));
    }
  };
  const skipOccurrence = (work: RecurringWorkRecord, date: Date) => {
    const cellKey = dayKey(date);
    const occurrence = (work.upcomingRuns ?? []).find(
      (timestamp) => dayKey(new Date(timestamp)) === cellKey,
    );
    const skipKey = occurrence
      ? workDateKeyIn(occurrence, work.timezone)
      : cellKey;
    const skipDates = work.skipDates ?? [];
    if (skipDates.includes(skipKey)) return;
    workspaceData.saveRecurringWork({
      ...work,
      skipDates: [...skipDates, skipKey],
      updatedAt: Date.now(),
    });
  };
  const editWork = editWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === editWorkId) ??
      null)
    : null;

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledDraft[]>();
    for (const draft of workspaceData.drafts) {
      // Drafts are review work even before a publishing time is chosen. Put
      // them on the day they were prepared, then move them to the scheduled
      // date once the user approves a concrete slot.
      const calendarTime = draft.scheduledFor ?? draft.createdAt;
      const key = dayKey(new Date(calendarTime));
      const items = map.get(key) ?? [];
      items.push(draft);
      map.set(key, items);
    }
    for (const items of map.values()) {
      items.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
    }
    return map;
  }, [workspaceData.drafts]);

  const recurringByDay = useMemo(() => {
    const map = new Map<string, RecurringWorkRecord[]>();
    for (const work of workspaceData.recurringWork) {
      for (const timestamp of work.upcomingRuns ?? []) {
        const key = dayKey(new Date(timestamp));
        const items = map.get(key) ?? [];
        if (!items.some((item) => item.id === work.id)) items.push(work);
        map.set(key, items);
      }
    }
    return map;
  }, [workspaceData.recurringWork]);

  const showPosts = visibleKinds.has("post");
  const showAgentWork = visibleKinds.has("agent-work");
  const pendingApprovals = workspaceData.recurringWork.filter(
    (work) => work.status === "draft" || work.status === "needs_approval",
  );
  const requestMonth = (month: Date) => {
    setMonthDirection(month > activeMonth ? 1 : -1);
    setScrollRequest((current) => ({ month, token: current.token + 1 }));
    setActiveMonth(month);
  };

  const move = (direction: number) => {
    if (view === "month") {
      requestMonth(addMonths(activeMonth, direction));
      return;
    }
    setSelected((date) => addDays(date, direction * (view === "week" ? 7 : 1)));
  };

  const focusedHeading =
    view === "week"
      ? `${startOfWeek(selected).toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(startOfWeek(selected), 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
      : selected.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 px-8 pt-6 pb-5">
        <div>
          <PageTitle>Schedule</PageTitle>
          <p className="text-muted-foreground mt-1 text-[13px]">
            See what is coming up and approve proposed schedules.
          </p>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 shrink-0 items-center justify-between gap-4 border-b border-black/[0.055] px-6 pb-3 dark:border-white/[0.055]">
          <div className="relative h-8 min-w-0 flex-1 overflow-hidden">
            {view === "month" ? (
              <MonthJump month={activeMonth} onSelect={requestMonth} />
            ) : (
              <AnimatePresence
                initial={false}
                mode="popLayout"
                custom={monthDirection}
              >
                <motion.p
                  key={focusedHeading}
                  initial={
                    reduceMotion
                      ? false
                      : { y: monthDirection * 18, opacity: 0 }
                  }
                  animate={{ y: 0, opacity: 1 }}
                  exit={
                    reduceMotion
                      ? { opacity: 0 }
                      : { y: monthDirection * -18, opacity: 0 }
                  }
                  transition={{
                    type: "spring",
                    stiffness: 440,
                    damping: 38,
                    mass: 0.7,
                  }}
                  className="absolute inset-x-0 min-w-0 truncate text-xl font-medium tracking-[-0.025em]"
                >
                  {focusedHeading}
                </motion.p>
              </AnimatePresence>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ScheduleInbox work={pendingApprovals} onOpen={openWorkReview} />
            <ScheduleFilters
              visibleKinds={visibleKinds}
              onToggle={(kind) => {
                setVisibleKinds((current) => {
                  const next = new Set(current);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(today);
                if (view === "month") requestMonth(currentMonth);
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => move(-1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => move(1)}>
              <ChevronRight size={14} />
            </Button>
            <div className="bg-muted/45 flex rounded-lg p-0.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
              {(["month", "week", "day"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-[11px] font-medium capitalize transition-[background-color,box-shadow,color]",
                    view === option &&
                      "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-background min-h-0 min-w-0 flex-1 overflow-hidden border-b border-black/[0.055] dark:border-white/[0.055]">
          {view === "month" ? (
            <ContinuousMonthView
              currentMonth={currentMonth}
              activeMonth={activeMonth}
              onActiveMonthChange={(month) => {
                setMonthDirection(month > activeMonth ? 1 : -1);
                setActiveMonth(month);
              }}
              today={today}
              now={now}
              selected={selected}
              onSelect={setSelected}
              onWorkOpen={openWorkReview}
              onDraftOpen={(draft) => setDetailDraftId(draft.id)}
              onWorkContext={(work, date, x, y) =>
                setWorkMenu({ work, date, x, y })
              }
              byDay={byDay}
              recurringByDay={recurringByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
              scrollRequest={scrollRequest}
            />
          ) : (
            <FocusedCalendarView
              view={view}
              selected={selected}
              today={today}
              now={now}
              onSelect={setSelected}
              onWorkOpen={openWorkReview}
              onDraftOpen={(draft) => setDetailDraftId(draft.id)}
              onWorkContext={(work, date, x, y) =>
                setWorkMenu({ work, date, x, y })
              }
              byDay={byDay}
              recurringByDay={recurringByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
            />
          )}
        </div>
      </section>
      <RecurringWorkApprovalDialog
        work={approvalWork}
        now={now}
        onClose={() => setApprovalWorkId(null)}
        onApprove={(work) => {
          workspaceData.saveRecurringWork({
            ...work,
            status: "active",
            grant: {
              version: 1,
              approvedAt: Date.now(),
              toolPatterns: work.proposedToolPatterns,
            },
            updatedAt: Date.now(),
          });
          const actionItem = workspaceData.actionItems.find(
            (item) =>
              item.status === "open" &&
              item.id === `action-${work.id}-approval`,
          );
          if (actionItem) workspaceData.dismissActionItem(actionItem.id);
        }}
        onReject={(work) => {
          workspaceData.deleteRecurringWork(work.id);
          const actionItem = workspaceData.actionItems.find(
            (item) =>
              item.status === "open" &&
              item.id === `action-${work.id}-approval`,
          );
          if (actionItem) workspaceData.dismissActionItem(actionItem.id);
        }}
        revision={{
          available: Boolean(revisionDriver),
          busy:
            !revisionChat.chatReady ||
            revisionChat.controls.status === "running",
          note: revisionNote,
          onRequest: requestRevision,
        }}
      />
      <ScheduleEventDetailDialog
        work={detailWork}
        draft={detailDraft}
        onClose={() => {
          setDetailWorkId(null);
          setDetailDraftId(null);
        }}
        onEditWork={(work) => {
          setDetailWorkId(null);
          setEditWorkId(work.id);
        }}
        onOpenDraft={(draft) => {
          setDetailDraftId(null);
          if (draft.fileId) {
            void navigate(`/files/${encodeURIComponent(draft.fileId)}`);
          }
        }}
      />
      <RecurringWorkContextMenu
        context={workMenu}
        onClose={() => setWorkMenu(null)}
        onSkip={skipOccurrence}
        onEdit={(work) => setEditWorkId(work.id)}
        onCancelSeries={(work) => workspaceData.deleteRecurringWork(work.id)}
      />
      <RecurringWorkEditDialog
        key={editWork?.id ?? "closed"}
        work={editWork}
        onClose={() => setEditWorkId(null)}
        onSave={(work, patch) =>
          workspaceData.saveRecurringWork({
            ...work,
            ...patch,
            updatedAt: Date.now(),
          })
        }
      />
    </div>
  );
}
