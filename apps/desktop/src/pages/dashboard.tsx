import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { SessionRecord } from "@chief/agent-runtime/types";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { AttentionPill } from "../components/attention-pill";
import { ChatComposer } from "../components/chat/chat-composer";
import { InputRequestSection } from "../components/integrations/input-request-section";
import { OverviewActionContextLink } from "../components/overview-action-context-link";
import {
  AnalyticsChart,
  OverviewActionPagination,
  overviewButton,
  Trend,
  WorkspaceIndicator,
  WorkspaceLearningCard,
} from "../components/overview-presentation";
import { PageTitle } from "../components/page-title";
import { actionAttentionTarget } from "../lib/channel-action-items";
import { isQuestionActionRequest } from "../lib/input-request-presentation";
import {
  findPendingInputRequest,
  isGoogleAnalyticsConnectionAction,
} from "../lib/integration-setup";
import { isOnboardingEngineeringAction } from "../lib/onboarding-engineering";
import { useObservedChat } from "../lib/runtime";
import {
  resolvedChannelChatId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../lib/workspace-channels";
import { useDashboardController } from "./use-dashboard-controller";

const AGENT_NAMES: Record<string, string> = {
  ads: "Ads Manager",
  analyst: "Analyst",
  brand: "Marketer",
  chief: "Chief",
  content: "Content Writer",
  engineer: "Engineer",
  prospector: "Prospector",
  setup: "Setup",
};

const OVERVIEW_MENTION_CANDIDATES = Object.entries(WORKSPACE_AGENT_IDENTITIES)
  .filter(([id]) => id !== "setup")
  .map(([id, identity]) => ({
    id,
    ...identity,
    member: id === "chief",
  }));

const overviewSurface =
  "bg-card rounded-2xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent),inset_0_1px_0_rgba(255,255,255,0.045),0_8px_24px_rgba(0,0,0,0.025)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055),inset_0_1px_0_rgba(255,255,255,0.035)]";

function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function OverviewTaskInput({ task }: { task: SessionRecord }) {
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { messages, provideInput, chatReady } = useObservedChat(
    task.id,
    task.scheduleId,
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, answeredInputs),
    [answeredInputs, messages],
  );

  if (!chatReady) {
    return (
      <p className="text-muted-foreground mt-4 animate-pulse text-xs">
        Loading the task request…
      </p>
    );
  }
  if (!pendingInput) return null;

  return (
    <div className="mt-5 w-full max-w-[620px]">
      <InputRequestSection
        request={pendingInput}
        embedded
        compactDecision={isQuestionActionRequest(pendingInput)}
        compactDecisionAgentName={
          isQuestionActionRequest(pendingInput)
            ? (AGENT_NAMES[task.agent] ?? task.agent)
            : undefined
        }
        onSubmit={(request, values) => {
          provideInput(request, values);
          setAnsweredInputs((current) => new Set(current).add(request.id));
        }}
      />
    </div>
  );
}

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

export function DashboardPage() {
  const {
    activeAnalyticsSlide,
    agentSchedules,
    agentWorkTimeline,
    analyticsIndex,
    analyticsSlides,
    ask,
    askAttachments,
    chiefNavigation,
    cloudOrganizationId,
    continuingChatId,
    currentAction,
    currentActionBlocked,
    currentActionChannel,
    currentActionDirectAgentId,
    currentActionFailed,
    currentActionInProgress,
    currentActionTarget,
    currentActionTask,
    firstName,
    learningSelected,
    localChats,
    moveAction,
    moveAnalytics,
    navigate,
    nextEngineeringIntegration,
    openAction,
    organization,
    overviewActions,
    prefersReducedMotion,
    preparingWorkspace,
    questionAction,
    resolveAction,
    resolvedOverviewActionIndex,
    selectAnalytics,
    setAnalyticsPaused,
    setAsk,
    setAskAttachments,
    setContinuingChatId,
    setSelectedActionId,
    simpleDecision,
    submit,
    user,
    workspaceData,
  } = useDashboardController();
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1120px] flex-col overflow-hidden pt-3 pb-[176px] max-[760px]:h-auto max-[760px]:overflow-visible max-[760px]:pb-[250px]">
      <div className="flex min-h-0 flex-1 flex-col justify-center pt-6">
        <header className="mb-6 flex shrink-0 items-start justify-between gap-6 max-[760px]:flex-col">
          <div>
            <PageTitle size="overview">
              {greeting(workspaceData.now)}, {firstName}
            </PageTitle>
            <p className="text-muted-foreground mt-2 text-xs">
              An overview of your channels and agents.
            </p>
          </div>
          <WorkspaceIndicator organization={organization} />
        </header>

        <section className="grid h-[clamp(500px,calc(100vh-250px),560px)] min-h-0 w-full flex-none grid-cols-[minmax(0,1.7fr)_minmax(310px,0.9fr)] gap-3.5 max-[930px]:grid-cols-[minmax(0,1fr)_300px] max-[760px]:h-auto max-[760px]:grid-cols-1">
          <section
            className={cn(
              overviewSurface,
              "flex min-h-0 min-w-0 flex-col overflow-hidden",
            )}
            aria-label="Action items"
          >
            {learningSelected ? (
              <WorkspaceLearningCard
                actions={overviewActions}
                index={resolvedOverviewActionIndex}
                onMove={moveAction}
                reviewChatId={resolvedChannelChatId(
                  workspaceData.waysOfWorking.missionControlChannelId,
                  cloudOrganizationId,
                  localChats.chats,
                )}
                onOpen={() => {
                  const channel =
                    workspaceData.waysOfWorking.missionControlChannelId;
                  void navigate(`/conversations?channel=${channel}`);
                }}
              />
            ) : currentAction ? (
              <article
                className={cn(
                  "relative flex min-h-0 flex-1 flex-col p-7",
                  (!currentAction.request || simpleDecision) &&
                    "justify-center",
                )}
              >
                {!questionAction ? (
                  <AttentionPill className="absolute top-6 right-7" />
                ) : null}
                {!questionAction ? (
                  <header className="flex items-start justify-between gap-3.5">
                    <div className="flex items-center gap-2.5">
                      {currentActionInProgress ? (
                        <LoaderCircle
                          className="text-muted-foreground animate-spin"
                          size={13}
                        />
                      ) : null}
                      <span className="grid gap-0.5">
                        <strong className="text-[12px] font-medium">
                          {AGENT_NAMES[currentAction.agentId] ??
                            currentAction.agentId}
                        </strong>
                        <small className="text-muted-foreground text-[10px]">
                          {currentActionInProgress
                            ? "Task in progress"
                            : `Prepared ${new Intl.RelativeTimeFormat(
                                undefined,
                                {
                                  numeric: "auto",
                                },
                              ).format(
                                Math.max(
                                  -30,
                                  Math.round(
                                    (currentAction.createdAt -
                                      workspaceData.now) /
                                      86_400_000,
                                  ),
                                ),
                                "day",
                              )}`}
                        </small>
                      </span>
                    </div>
                  </header>
                ) : null}
                <div
                  className={cn(
                    "my-10 max-w-[610px]",
                    currentAction.request &&
                      !questionAction &&
                      "mt-7 mb-5 flex min-h-0 w-full max-w-[680px] flex-1 flex-col",
                    simpleDecision &&
                      "mx-auto my-auto w-full max-w-[560px] flex-none translate-y-4",
                    questionAction &&
                      !simpleDecision &&
                      "mx-auto my-0 flex min-h-0 w-full max-w-[560px] flex-1 flex-col overflow-hidden pt-6 pr-1 pb-16",
                  )}
                >
                  {questionAction ? (
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <AttentionPill />
                      <OverviewActionContextLink
                        actionId={currentAction.id}
                        channel={currentActionTarget}
                        channelLabel={
                          currentActionChannel?.name ??
                          currentActionChannel?.slug
                        }
                        directAgentId={currentActionDirectAgentId}
                      />
                    </div>
                  ) : null}
                  <h2
                    className={cn(
                      "m-0 font-normal",
                      questionAction
                        ? "max-w-[540px] text-[24px] leading-[1.25] tracking-[-0.025em]"
                        : "text-[clamp(23px,2.7vw,33px)] leading-[1.1] tracking-[-0.035em]",
                    )}
                  >
                    {simpleDecision?.question ?? currentAction.title}
                  </h2>
                  {!questionAction ? (
                    <p className="text-muted-foreground mt-3 line-clamp-2 max-w-[560px] text-[13px] leading-6">
                      {currentAction.reason.trim() ||
                        "This action needs your review."}
                    </p>
                  ) : null}
                  {currentActionTask?.status === "needs_approval" ? (
                    <OverviewTaskInput
                      key={currentActionTask.id}
                      task={currentActionTask}
                    />
                  ) : null}
                  {currentAction.request &&
                  !isGoogleAnalyticsConnectionAction(currentAction) ? (
                    <div
                      className={cn(
                        "w-full max-w-[620px]",
                        questionAction
                          ? "mt-8 flex min-h-0 flex-1 flex-col"
                          : "mt-5",
                      )}
                    >
                      <InputRequestSection
                        key={currentAction.request.id}
                        request={currentAction.request}
                        embedded
                        compactDecision={questionAction}
                        compactDecisionAgentName={
                          questionAction
                            ? (AGENT_NAMES[currentAction.agentId] ??
                              currentAction.agentId)
                            : undefined
                        }
                        compactDecisionHideQuestionLabels={Boolean(
                          simpleDecision,
                        )}
                        compactDecisionCurrentUser={user}
                        compactDecisionSecondaryAction={
                          questionAction &&
                          !currentActionInProgress &&
                          !currentAction.id.startsWith(
                            "onboarding-google-analytics-recovery-",
                          ) &&
                          !isOnboardingEngineeringAction(currentAction)
                            ? {
                                label: "Dismiss",
                                onClick: () =>
                                  workspaceData.dismissActionItem(
                                    currentAction.id,
                                  ),
                              }
                            : undefined
                        }
                        compactDecisionSurface="overview"
                        onSubmit={(request, values, answers) => {
                          if (currentAction.sourceId) {
                            setContinuingChatId(currentAction.sourceId);
                          }
                          const resolution = workspaceData.resolveActionRequest(
                            currentAction.id,
                            request.id,
                            answers,
                            values,
                          );
                          const target = actionAttentionTarget({
                            action: currentAction,
                            sessions: workspaceData.activity,
                            recurringWork: workspaceData.recurringWork,
                          });
                          if (target) {
                            chiefNavigation.open({
                              kind: "conversation",
                              channelId: target.channelId,
                              threadRootId: target.threadRootId,
                              messageId: currentAction.id,
                            });
                          } else if (currentActionDirectAgentId) {
                            chiefNavigation.open({
                              kind: "conversation",
                              channelId: `direct:${currentActionDirectAgentId}`,
                              directAgentId: currentActionDirectAgentId,
                              messageId: currentAction.id,
                            });
                          }
                          return resolution.catch((error) => {
                            setContinuingChatId(null);
                            throw error;
                          });
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <footer
                  className={cn(
                    "flex items-center gap-4",
                    questionAction
                      ? "absolute bottom-7 left-7"
                      : "mt-auto justify-between",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {isGoogleAnalyticsConnectionAction(currentAction) ||
                    isOnboardingEngineeringAction(currentAction) ? (
                      <button
                        className={cn(
                          overviewButton,
                          "bg-foreground text-background hover:bg-foreground/90",
                        )}
                        type="button"
                        onClick={() => openAction()}
                      >
                        {isOnboardingEngineeringAction(currentAction)
                          ? `Connect ${nextEngineeringIntegration?.name ?? "tool"}`
                          : currentAction.request
                            ? "Continue setup"
                            : "Connect integration"}
                      </button>
                    ) : !currentAction.request ? (
                      <button
                        className={cn(
                          overviewButton,
                          "bg-foreground text-background hover:bg-foreground/90",
                        )}
                        type="button"
                        onClick={resolveAction}
                      >
                        {currentActionBlocked
                          ? "Allow and retry"
                          : currentActionFailed
                            ? "Start again"
                            : currentActionInProgress
                              ? "View task"
                              : "Review"}
                      </button>
                    ) : null}
                    {!questionAction &&
                    !currentActionInProgress &&
                    !currentAction.id.startsWith(
                      "onboarding-google-analytics-recovery-",
                    ) &&
                    !isOnboardingEngineeringAction(currentAction) ? (
                      <button
                        className={overviewButton}
                        type="button"
                        aria-keyshortcuts="E"
                        onClick={() =>
                          workspaceData.dismissActionItem(currentAction.id)
                        }
                        title="Dismiss (E)"
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                  <OverviewActionPagination
                    actions={overviewActions}
                    index={resolvedOverviewActionIndex}
                    onMove={moveAction}
                  />
                </footer>
              </article>
            ) : (
              <article className="relative flex min-h-0 flex-1 flex-col items-start justify-center p-7">
                {preparingWorkspace ? (
                  <MatrixLoader
                    ariaLabel="Chief is learning"
                    className="text-muted-foreground mb-6"
                    fps={6}
                    size={15}
                  />
                ) : (
                  <Check className="text-muted-foreground mb-6" size={18} />
                )}
                <h2 className="m-0 text-[clamp(24px,3vw,34px)] leading-tight font-normal tracking-[-0.03em]">
                  {preparingWorkspace
                    ? workspaceData.loading
                      ? "Checking the workspace…"
                      : continuingChatId
                        ? "Chief is on it."
                        : "Chief is learning your business."
                    : "You’re caught up."}
                </h2>
                <p className="text-muted-foreground mt-3 mb-6 max-w-[520px] text-[13px] leading-6">
                  {preparingWorkspace
                    ? workspaceData.loading
                      ? "Chief is gathering the latest work from your agents."
                      : continuingChatId
                        ? "Chief is continuing the setup with the details you provided. Follow the work in the conversation."
                        : "Chief is reviewing your website, saved context and connected sources. You can leave this open; the work will continue."
                    : agentSchedules.length > 0
                      ? `Nothing needs your judgment. ${agentSchedules.length} recurring ${agentSchedules.length === 1 ? "task is" : "tasks are"} still active.`
                      : "Nothing needs your judgment. Choose recurring work when you’re ready to put the team in motion."}
                </p>
                <button
                  className={cn(
                    overviewButton,
                    continuingChatId &&
                      "bg-foreground text-background hover:bg-foreground/90",
                  )}
                  type="button"
                  onClick={() =>
                    continuingChatId
                      ? navigate(
                          `/conversations?chat=${encodeURIComponent(continuingChatId)}`,
                        )
                      : navigate("/schedule")
                  }
                >
                  {continuingChatId ? "View Chief's work" : "View schedule"}{" "}
                  <ArrowRight size={13} />
                </button>
              </article>
            )}

            {overviewActions.length > 1 ? (
              <nav
                aria-label="Choose an action item"
                className="shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent)]"
              >
                {overviewActions.slice(0, 4).map((item, index) => (
                  <button
                    className={cn(
                      "text-muted-foreground hover:text-foreground grid min-h-10 w-full grid-cols-[minmax(0,1fr)_120px] items-center gap-3 bg-transparent px-5 py-2 text-left shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)] transition-colors first:shadow-none hover:bg-black/[0.025] max-[930px]:grid-cols-1 dark:hover:bg-white/[0.03]",
                      index === resolvedOverviewActionIndex &&
                        "text-foreground bg-black/[0.025] dark:bg-white/[0.03]",
                    )}
                    key={item.id}
                    onClick={() => setSelectedActionId(item.id)}
                    type="button"
                  >
                    <strong className="min-w-0 truncate text-[12px] font-medium">
                      {item.title}
                    </strong>
                    <small className="truncate text-right text-[10px] max-[930px]:hidden">
                      {AGENT_NAMES[item.agentId] ?? item.agentId}
                    </small>
                  </button>
                ))}
              </nav>
            ) : null}
          </section>

          <aside className="grid min-h-0 min-w-0 grid-rows-[minmax(210px,0.85fr)_minmax(270px,1.15fr)] gap-2.5 max-[760px]:grid-cols-2 max-[760px]:grid-rows-none">
            <section
              aria-label="Workspace analytics"
              className={cn(
                overviewSurface,
                "relative min-w-0 overflow-visible",
              )}
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
                overviewSurface,
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
                      const state =
                        item.kind === "active"
                          ? item.status === "completed"
                            ? "Complete"
                            : item.status === "failed"
                              ? "Needs attention"
                              : item.status === "waiting"
                                ? "Waiting for input"
                                : item.childId
                                  ? "Specialist working"
                                  : item.taskCount
                                    ? `${item.taskCount} ${item.taskCount === 1 ? "task" : "tasks"} in progress`
                                    : "Working now"
                          : item.onceAt === undefined
                            ? "Scheduled"
                            : "One-time task";
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
                              {item.kind === "active" &&
                              item.status === "running" ? (
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
                              {state} ·{" "}
                              {AGENT_NAMES[item.agentId] ?? item.agentId}
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
                      <small className="text-[10px]">
                        Your schedule is clear.
                      </small>
                    </span>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center px-7 pb-5 before:absolute before:-inset-x-7 before:-top-16 before:-bottom-5 before:-z-10 before:bg-[linear-gradient(to_bottom,transparent,var(--background)_55%,var(--background))]">
        <ChatComposer
          className="pointer-events-auto w-full max-w-3xl"
          value={ask}
          onValueChange={setAsk}
          onSubmit={submit}
          imageAttachments={askAttachments}
          onImageAttachmentsChange={setAskAttachments}
          mentionCandidates={OVERVIEW_MENTION_CANDIDATES}
          showExecutionControls={false}
        />
      </div>
    </div>
  );
}
