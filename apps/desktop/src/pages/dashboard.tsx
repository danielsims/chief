import { ArrowRight, Check, LoaderCircle } from "lucide-react";

import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { AttentionPill } from "../components/attention-pill";
import { ChatComposer } from "../components/chat/chat-composer";
import { InputRequestSection } from "../components/integrations/input-request-section";
import { OverviewActionContextLink } from "../components/overview-action-context-link";
import {
  OverviewActionPagination,
  overviewButton,
  WorkspaceIndicator,
  WorkspaceLearningCard,
} from "../components/overview-presentation";
import { PageTitle } from "../components/page-title";
import { actionAttentionTarget } from "../lib/channel-action-items";
import { isGoogleAnalyticsConnectionAction } from "../lib/integration-setup";
import { isOnboardingEngineeringAction } from "../lib/onboarding-engineering";
import { resolvedChannelChatId } from "../lib/workspace-channels";
import {
  DASHBOARD_AGENT_NAMES,
  DASHBOARD_MENTION_CANDIDATES,
} from "./dashboard-constants";
import { DashboardSidePanels } from "./dashboard-side-panels";
import { DashboardTaskInput } from "./dashboard-task-input";
import { useDashboardController } from "./use-dashboard-controller";

const overviewSurface =
  "bg-card rounded-2xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent),inset_0_1px_0_rgba(255,255,255,0.045),0_8px_24px_rgba(0,0,0,0.025)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055),inset_0_1px_0_rgba(255,255,255,0.035)]";

function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
                          {DASHBOARD_AGENT_NAMES[currentAction.agentId] ??
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
                    <DashboardTaskInput
                      key={currentActionTask.id}
                      agentName={
                        DASHBOARD_AGENT_NAMES[currentActionTask.agent] ??
                        currentActionTask.agent
                      }
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
                            ? (DASHBOARD_AGENT_NAMES[currentAction.agentId] ??
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
                      {DASHBOARD_AGENT_NAMES[item.agentId] ?? item.agentId}
                    </small>
                  </button>
                ))}
              </nav>
            ) : null}
          </section>

          <DashboardSidePanels
            activeAnalyticsSlide={activeAnalyticsSlide}
            agentName={(agentId) => DASHBOARD_AGENT_NAMES[agentId] ?? agentId}
            agentWorkTimeline={agentWorkTimeline}
            analyticsIndex={analyticsIndex}
            analyticsSlides={analyticsSlides}
            moveAnalytics={moveAnalytics}
            navigate={navigate}
            prefersReducedMotion={prefersReducedMotion}
            selectAnalytics={selectAnalytics}
            setAnalyticsPaused={setAnalyticsPaused}
            surfaceClassName={overviewSurface}
            workspaceData={workspaceData}
          />
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
          mentionCandidates={DASHBOARD_MENTION_CANDIDATES}
          showExecutionControls={false}
        />
      </div>
    </div>
  );
}
