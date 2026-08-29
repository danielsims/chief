import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import { toast } from "sonner";

import type {
  CampaignRecord,
  DriverType,
  OnboardingSchedule,
  OnboardingWorkJob,
  RecurringWorkRecord,
} from "@chief/agent-runtime/types";

import { useAuth } from "./auth/auth-context";
import {
  completePendingOnboardingWork,
  mergePendingOnboardingSchedules,
  pendingOnboardingWorkStorageKey,
} from "./pending-onboarding-work";
/** Durable NIP-29 events for channel timelines and message search. */
import { RuntimeCoreProvider } from "./runtime-provider";
import { workspaceDataCache } from "./runtime-workspace-hooks";
import { useRuntimeWorkspaceSource } from "./use-runtime-workspace-source";

export {
  messageBlocks,
  useAgentPreferences,
  useDiagnostics,
  useDisconnectGoogleAnalytics,
  useStoredInputs,
  useWorkspaceEmailPreview,
  useWorkspaceEnvironmentVariables,
  useWorkspaceFile,
  useWorkspaceFiles,
  type ChatControlState,
  type PendingApproval,
  type PendingQuestion,
} from "./runtime-diagnostics";
export { useRuntime, type RuntimeStatus } from "./runtime-provider";
export {
  updatePendingOnboardingDriver,
  useChannelEvents,
  useChannelReactions,
  useLocalChats,
  useProviderModels,
  useWorkspaceChannels,
  type LocalChatSummary,
} from "./runtime-workspace-hooks";
export { useWorkspaceCapability } from "./workspace-capability";

function useWorkspaceDataSource(workspaceId: string | null) {
  const {
    capability,
    capabilityError,
    client,
    cloudOrganizationId,
    data,
    loading,
    now,
    pendingActionRequestsRef,
    recurringWorkSettings,
    runMissionControlHeartbeatNow,
    saveWaysOfWorking,
    setData,
    status,
    user,
  } = useRuntimeWorkspaceSource(workspaceId);
  const liveData = useMemo(
    () => ({
      ...data,
      recurringWork: data.recurringWork.map((work) => ({
        ...work,
        upcomingRuns: work.upcomingRuns?.filter((timestamp) => timestamp > now),
      })),
    }),
    [data, now],
  );

  const saveCampaign = (campaign: CampaignRecord) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        campaigns: [
          campaign,
          ...current.campaigns.filter((item) => item.id !== campaign.id),
        ],
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "saveCampaign",
      workspaceId,
      campaign,
      executorCapability: capability,
    });
  };

  const bootstrapOnboardingWork = useCallback(
    (
      jobs: OnboardingWorkJob[],
      schedules: OnboardingSchedule[],
      workspaceContext?: string,
      driver?: DriverType,
      model?: string | null,
    ) => {
      if (workspaceId) {
        window.localStorage.setItem(
          pendingOnboardingWorkStorageKey(workspaceId),
          JSON.stringify({ jobs, schedules, workspaceContext, driver, model }),
        );
        setData((current) => {
          const next = mergePendingOnboardingSchedules(workspaceId, current);
          workspaceDataCache.set(workspaceId, next);
          return next;
        });
      }
      if (
        !workspaceId ||
        workspaceId !== cloudOrganizationId ||
        !capability ||
        status !== "connected"
      ) {
        return Promise.reject(
          new Error("Chief is still connecting to this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("Chief could not finish preparing this workspace."));
        }, 120_000);
        const unsubscribe = client.subscribe((message) => {
          if (
            message.type === "onboardingWorkBootstrapped" &&
            message.workspaceId === workspaceId &&
            message.requestId === requestId
          ) {
            window.clearTimeout(timeout);
            unsubscribe();
            completePendingOnboardingWork(workspaceId);
            resolve(message.chatId);
          }
          if (message.type === "error" && message.requestId === requestId) {
            window.clearTimeout(timeout);
            unsubscribe();
            reject(new Error(message.message));
          }
        });
        client.send({
          type: "bootstrapOnboardingWork",
          workspaceId,
          requestId,
          jobs,
          schedules,
          workspaceContext,
          driver,
          model,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, setData, status, workspaceId],
  );

  const saveRecurringWork = (work: RecurringWorkRecord) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        recurringWork: current.recurringWork.map((item) =>
          item.id === work.id ? work : item,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "saveRecurringWork",
      workspaceId,
      work,
      executorCapability: capability,
    });
  };

  const runRecurringWorkNow = (recurringWorkId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    client.send({
      type: "runRecurringWorkNow",
      workspaceId,
      recurringWorkId,
      executorCapability: capability,
    });
  };

  const expandRecurringWorkGrant = (
    recurringWorkId: string,
    addTools: string[],
    rerun: boolean,
  ) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    client.send({
      type: "expandRecurringWorkGrant",
      workspaceId,
      recurringWorkId,
      addTools,
      rerun,
      executorCapability: capability,
    });
  };

  const dismissActionItem = (actionItemId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        actionItems: current.actionItems.filter(
          (item) => item.id !== actionItemId,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "dismissActionItem",
      workspaceId,
      actionItemId,
      executorCapability: capability,
    });
  };

  const resolveActionRequest = (
    actionItemId: string,
    requestId: string,
    answers: Record<string, string>,
    values: Record<string, string>,
    setup?: { chatId: string; domain: string },
  ) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return Promise.reject(new Error("Workspace runtime is unavailable."));
    }
    if (!user) {
      return Promise.reject(new Error("Sign in again to answer this request."));
    }
    return new Promise<void>((resolve, reject) => {
      const existing = pendingActionRequestsRef.current.get(requestId);
      if (existing) window.clearTimeout(existing.timer);
      const timer = window.setTimeout(() => {
        pendingActionRequestsRef.current.delete(requestId);
        const error = new Error(
          "Chief did not confirm the saved input. Try again.",
        );
        toast.error(error.message);
        reject(error);
      }, 30_000);
      pendingActionRequestsRef.current.set(requestId, {
        resolve,
        reject,
        timer,
      });
      client.send({
        type: "resolveActionRequest",
        workspaceId,
        actionItemId,
        requestId,
        answers,
        values,
        resolvedBy: { id: user.id, name: user.name },
        setup,
        executorCapability: capability,
      });
    });
  };

  const deleteRecurringWork = (recurringWorkId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        recurringWork: current.recurringWork.filter(
          (item) => item.id !== recurringWorkId,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "deleteRecurringWork",
      workspaceId,
      recurringWorkId,
      executorCapability: capability,
    });
  };

  return {
    ...liveData,
    loading,
    now,
    onboardingBootstrapReady:
      status === "connected" &&
      Boolean(capability) &&
      workspaceId === cloudOrganizationId,
    onboardingBootstrapError: capabilityError,
    bootstrapOnboardingWork,
    saveCampaign,
    saveRecurringWork,
    runRecurringWorkNow,
    deleteRecurringWork,
    dismissActionItem,
    resolveActionRequest,
    expandRecurringWorkGrant,
    saveWaysOfWorking,
    runMissionControlHeartbeatNow,
    saveRecurringWorkSettings: recurringWorkSettings.save,
    rotateRecurringWorkWebhook: recurringWorkSettings.rotateWebhook,
  };
}

type WorkspaceDataContextValue = ReturnType<typeof useWorkspaceDataSource>;

const WorkspaceDataContext = createContext<WorkspaceDataContextValue | null>(
  null,
);

function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId } = useAuth();
  const value = useWorkspaceDataSource(cloudOrganizationId);
  return (
    <WorkspaceDataContext.Provider value={value}>
      {children}
    </WorkspaceDataContext.Provider>
  );
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  return (
    <RuntimeCoreProvider>
      <WorkspaceDataProvider>{children}</WorkspaceDataProvider>
    </RuntimeCoreProvider>
  );
}

export function useWorkspaceData(workspaceId: string | null) {
  const value = useContext(WorkspaceDataContext);
  if (!value) {
    throw new Error("useWorkspaceData must be used inside RuntimeProvider");
  }
  // Consumers still pass the active workspace id for a narrow, explicit API.
  // The provider owns the subscription so route changes never create a second
  // listener or briefly replace live data with an empty page.
  void workspaceId;
  return value;
}
