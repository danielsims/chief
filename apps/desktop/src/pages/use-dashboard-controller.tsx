import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";

import type { ActionItem, AnalyticsDataset } from "@chief/agent-runtime/types";

import type { ComposerImageAttachment } from "../components/chat/composer-image-attachments";
import type { OverviewAction } from "../components/overview-presentation";
import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { createComposerHandoff } from "../components/chat/composer-handoff";
import { useAuth } from "../lib/auth/auth-context";
import { actionAttentionTarget } from "../lib/channel-action-items";
import { useChiefNavigation } from "../lib/chief-navigation-context";
import {
  isQuestionActionRequest,
  simpleDecisionQuestion,
} from "../lib/input-request-presentation";
import {
  integrationSetupChannelPath,
  isConnectionAction,
  isGoogleAnalyticsConnectionAction,
  isOnboardingGoogleAnalyticsAction,
} from "../lib/integration-setup";
import { useLocalIntegrationStatus } from "../lib/local-integration-status";
import {
  isOnboardingEngineeringAction,
  onboardingEngineeringSetup,
} from "../lib/onboarding-engineering";
import { useRelaySession } from "../lib/relay-session";
import {
  useLocalChats,
  useWorkspaceChannels,
  useWorkspaceData,
} from "../lib/runtime";
import {
  actionConversation,
  directMessageAgentIdFromChatId,
} from "../lib/workspace-channels";
import { useDashboardInsights } from "./use-dashboard-insights";

const LEARNING_ACTION_ID = "workspace-onboarding";

export function useDashboardController() {
  const navigate = useNavigate();
  const chiefNavigation = useChiefNavigation();
  const prefersReducedMotion = useReducedMotion();
  const [ask, setAsk] = useState("");
  const [askAttachments, setAskAttachments] = useState<
    ComposerImageAttachment[]
  >([]);
  const { cloudOrganizationId, user } = useAuth();
  const { snapshot } = useRelaySession();
  const localChats = useLocalChats(cloudOrganizationId);
  const organization = useMemo<AuthOrganization | null>(
    () =>
      snapshot
        ? {
            id: snapshot.id,
            name: snapshot.name,
            slug: snapshot.id,
            logo: snapshot.imageURL,
            metadata: { websiteUrl: snapshot.website },
          }
        : null,
    [snapshot],
  );
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [continuingChatId, setContinuingChatId] = useState<string | null>(null);
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const workspaceChannels = useWorkspaceChannels();
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const datasets = workspaceData.loading
    ? undefined
    : workspaceData.analyticsDatasets.filter(
        (dataset) => dataset.key === "overview",
      );

  const agentSchedules = workspaceData.recurringWork.filter(
    (work) =>
      work.onceAt === undefined &&
      (work.status === "active" || work.status === "draft"),
  );
  const newProspects = workspaceData.prospects.filter(
    (prospect) => prospect.status === "new",
  ).length;
  const analytics = datasets?.reduce<AnalyticsDataset | undefined>(
    (latest, dataset) =>
      !latest || dataset.capturedAt > latest.capturedAt ? dataset : latest,
    undefined,
  );
  const analytics30 =
    analytics?.periods.find((period) => period.key === "30d") ??
    analytics?.periods.find((period) => period.key === "current") ??
    analytics?.periods[0];
  const previous30 =
    analytics?.periods.find(
      (period) => period.key === "previous30d" || period.key === "previous",
    ) ?? analytics?.periods.find((period) => period !== analytics30);
  const scheduleById = useMemo(
    () => new Map(workspaceData.recurringWork.map((work) => [work.id, work])),
    [workspaceData.recurringWork],
  );
  const privateTasksById = useMemo(
    () =>
      new Map(
        workspaceData.activity
          .filter(
            (session) =>
              session.kind === "task" && session.visibility === "private",
          )
          .map((session) => [session.id, session]),
      ),
    [workspaceData.activity],
  );
  const engineeringSetup = useMemo(
    () =>
      onboardingEngineeringSetup(
        cloudOrganizationId,
        organization,
        localIntegrations,
      ),
    [cloudOrganizationId, localIntegrations, organization],
  );
  const nextEngineeringIntegration = engineeringSetup.nextIntegration;
  const actions = useMemo(() => {
    const tracked = workspaceData.actionItems.filter(
      (action) => action.status === "open",
    );
    const additions: ActionItem[] = [];
    if (
      engineeringSetup.action &&
      !tracked.some(isOnboardingEngineeringAction)
    ) {
      additions.push(engineeringSetup.action);
    }
    return [...additions, ...tracked];
  }, [engineeringSetup.action, workspaceData.actionItems]);
  const preparationRoot = workspaceData.activity.find(
    (session) =>
      (session.id.startsWith("workspace-kickoff-") ||
        session.id.endsWith(
          `:${workspaceData.waysOfWorking.missionControlChannelId}`,
        ) ||
        session.title === "Initial business review" ||
        session.title === "Getting started") &&
      session.kind === "conversation" &&
      session.visibility === "user",
  );
  const preparationChildren = useMemo(
    () =>
      preparationRoot
        ? workspaceData.activity.filter(
            (session) =>
              session.parentId === preparationRoot.id &&
              session.kind === "task" &&
              session.visibility === "private" &&
              !session.scheduleId,
          )
        : [],
    [preparationRoot, workspaceData.activity],
  );
  const preparationActive = Boolean(
    preparationRoot &&
    [preparationRoot, ...preparationChildren].some(
      (session) =>
        (session.status === "running" || session.status === "waiting") &&
        workspaceData.now - session.updatedAt < 10 * 60_000,
    ),
  );
  const onboardingOpenedAt = cloudOrganizationId
    ? Number(sessionStorage.getItem(`chief:onboarding:${cloudOrganizationId}`))
    : Number.NaN;
  const onboardingPending = Boolean(
    Number.isFinite(onboardingOpenedAt) &&
    workspaceData.now - onboardingOpenedAt < 10 * 60_000 &&
    (!preparationRoot || preparationRoot.status === "idle"),
  );
  const showLearningCard = onboardingPending || preparationActive;
  const overviewActions = useMemo<OverviewAction[]>(
    () => [
      ...(showLearningCard
        ? [
            {
              id: LEARNING_ACTION_ID,
              title: "Finish setting up with Chief",
              agentId: "chief",
            },
          ]
        : []),
      ...actions.map((action) => ({
        id: action.id,
        title: action.title,
        agentId: action.agentId,
        action,
      })),
    ],
    [actions, showLearningCard],
  );
  useEffect(() => {
    if (
      cloudOrganizationId &&
      preparationRoot &&
      preparationRoot.status !== "idle" &&
      preparationChildren.length > 0
    ) {
      sessionStorage.removeItem(`chief:onboarding:${cloudOrganizationId}`);
    }
  }, [cloudOrganizationId, preparationChildren.length, preparationRoot]);
  const requestedOverviewActionIndex = selectedActionId
    ? overviewActions.findIndex((item) => item.id === selectedActionId)
    : 0;
  const resolvedOverviewActionIndex = Math.max(0, requestedOverviewActionIndex);
  const selectedOverviewAction = overviewActions[resolvedOverviewActionIndex];
  const learningSelected = selectedOverviewAction?.id === LEARNING_ACTION_ID;
  const currentAction = selectedOverviewAction?.action;
  const simpleDecision = simpleDecisionQuestion(currentAction?.request);
  const questionAction = isQuestionActionRequest(currentAction?.request);
  const currentActionTarget = currentAction
    ? actionAttentionTarget({
        action: currentAction,
        sessions: workspaceData.activity,
        recurringWork: workspaceData.recurringWork,
      })
    : null;
  const currentActionChannel = currentActionTarget
    ? workspaceChannels.channels.find(
        (channel) => channel.id === currentActionTarget.channelId,
      )
    : null;
  const {
    activeAnalyticsSlide,
    agentWorkTimeline,
    analyticsIndex,
    analyticsSlides,
    moveAnalytics,
    selectAnalytics,
    setAnalyticsPaused,
  } = useDashboardInsights({
    analytics,
    analytics30,
    datasets,
    newProspects,
    preparationActive,
    preparationChildren,
    preparationRoot,
    prefersReducedMotion,
    previous30,
    scheduleById,
    workspaceData,
  });
  const currentActionDirectAgentId = directMessageAgentIdFromChatId(
    currentAction?.sourceId ?? null,
  );
  const currentActionTask = currentAction?.sourceId
    ? privateTasksById.get(currentAction.sourceId)
    : undefined;
  const currentActionInProgress = currentActionTask?.status === "running";
  const currentActionBlocked = Boolean(
    currentActionTask?.scheduleId && currentActionTask.blockedTools?.length,
  );
  const currentActionFailed = Boolean(
    currentActionTask?.scheduleId && currentActionTask.status === "failed",
  );
  useEffect(() => {
    if (!currentAction || currentActionInProgress) return;
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== "e" ||
        target?.isContentEditable ||
        target?.matches("input, textarea, select")
      ) {
        return;
      }
      event.preventDefault();
      workspaceData.dismissActionItem(currentAction.id);
    };
    window.addEventListener("keydown", dismissWithKeyboard);
    return () => window.removeEventListener("keydown", dismissWithKeyboard);
  }, [currentAction, currentActionInProgress, workspaceData]);

  const moveAction = (direction: number) => {
    if (overviewActions.length < 2) return;
    setSelectedActionId(
      overviewActions[
        (resolvedOverviewActionIndex + direction + overviewActions.length) %
          overviewActions.length
      ]?.id ?? null,
    );
  };

  const openAction = (action = currentAction) => {
    if (!action) return;
    if (
      isOnboardingEngineeringAction(action) &&
      nextEngineeringIntegration &&
      cloudOrganizationId
    ) {
      localStorage.setItem(
        `chief:integration-setup:${nextEngineeringIntegration.domain}`,
        "active",
      );
      void navigate(
        integrationSetupChannelPath(nextEngineeringIntegration, action.id),
      );
      return;
    }
    if (
      isGoogleAnalyticsConnectionAction(action) &&
      isOnboardingGoogleAnalyticsAction(action.id)
    ) {
      void navigate(
        integrationSetupChannelPath(
          { domain: "analytics.googleapis.com", name: "Google Analytics" },
          action.id,
        ),
      );
      return;
    }
    if (isGoogleAnalyticsConnectionAction(action)) {
      localStorage.setItem(
        "chief:integration-setup:analytics.googleapis.com",
        "active",
      );
      void navigate("/analytics");
      return;
    }
    if (action.sourceId === "agent-chief") {
      void navigate("/agents");
      return;
    }
    if (isConnectionAction(action)) {
      const prompt =
        `@Setup, help me complete “${action.title}” here with Chief. ${action.reason.trim()}`.trim();
      const params = new URLSearchParams({
        channel: workspaceData.waysOfWorking.missionControlChannelId,
        prompt,
      });
      void navigate(`/conversations?${params.toString()}`);
      return;
    }
    if (
      privateTasksById.get(action.sourceId ?? "")?.scheduleId ||
      action.sourceId?.startsWith("automation-")
    ) {
      void navigate("/schedule");
      return;
    }
    const prompt =
      `Please action “${action.title}”. ${action.reason.trim()}`.trim();
    const destination = actionConversation({
      ...action,
      missionControlChannelId:
        workspaceData.waysOfWorking.missionControlChannelId,
    });
    const params = new URLSearchParams({ prompt });
    params.set(destination.kind, destination.id);
    void navigate(`/conversations?${params.toString()}`);
  };

  const resolveAction = () => {
    if (
      currentActionBlocked &&
      currentActionTask?.scheduleId &&
      currentActionTask.blockedTools
    ) {
      workspaceData.expandRecurringWorkGrant(
        currentActionTask.scheduleId,
        currentActionTask.blockedTools,
        true,
      );
      return;
    }
    if (currentActionFailed && currentActionTask?.scheduleId) {
      workspaceData.runRecurringWorkNow(currentActionTask.scheduleId);
      return;
    }
    openAction();
  };

  const submit = () => {
    const text = ask.trim();
    if (!text && askAttachments.length === 0) return;
    const handoff = createComposerHandoff({
      text,
      attachments: askAttachments,
    });
    const params = new URLSearchParams({
      dm: "chief",
      handoff,
    });
    void navigate(`/conversations?${params.toString()}`);
  };

  const profileFirstName = user?.name.trim().split(/\s+/)[0];
  const firstName = profileFirstName ?? "there";
  const preparingWorkspace =
    workspaceData.loading ||
    onboardingPending ||
    preparationActive ||
    Boolean(continuingChatId);

  return {
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
  };
}
