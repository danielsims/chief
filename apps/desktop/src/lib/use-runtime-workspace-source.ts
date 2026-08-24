import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";

import type { WorkspaceDataState } from "./workspace-data";
import { useAuth } from "./auth/auth-context";
import {
  completePendingOnboardingWork,
  mergePendingOnboardingSchedules,
  parsePendingOnboardingBootstrap,
  pendingOnboardingWorkStorageKey,
  readPendingOnboardingWork,
  relayNeedsPendingOnboardingReplay,
} from "./pending-onboarding-work";
import { useRelaySession } from "./relay-session";
/** Durable NIP-29 events for channel timelines and message search. */
import { useManualMissionHeartbeat } from "./runtime-mission-heartbeat";
import { useRuntime } from "./runtime-provider";
import { useRecurringWorkSettings } from "./runtime-recurring-work";
import { useWaysOfWorkingSaver } from "./runtime-ways-of-working";
import { workspaceDataCache } from "./runtime-workspace-hooks";
import { useWorkspaceCapability } from "./workspace-capability";
import { emptyWorkspaceData, normalizeWorkspaceData } from "./workspace-data";

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

export function useRuntimeWorkspaceSource(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { snapshot: relaySnapshot } = useRelaySession();
  const { sessionToken, user } = useAuth();
  const {
    cloudOrganizationId,
    capability,
    error: capabilityError,
  } = useWorkspaceCapability();
  // Loading means "no data has ever resolved for this workspace". The cache
  // spans mounts, so navigating back to a page shows the last data at once
  // and revalidates in place instead of flashing empty or placeholder frames.
  const [data, setData] = useState<WorkspaceDataState>(() =>
    workspaceId
      ? mergePendingOnboardingSchedules(
          workspaceId,
          workspaceDataCache.get(workspaceId) ?? emptyWorkspaceData,
        )
      : emptyWorkspaceData,
  );
  const [loading, setLoading] = useState(
    () => !(workspaceId && workspaceDataCache.has(workspaceId)),
  );
  const [now, setNow] = useState(() => Date.now());
  const dataWorkspaceRef = useRef<string | null>(workspaceId);
  const workspaceRevisionRef = useRef(0);
  const pendingActionRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: number;
      }
    >(),
  );
  const applyWaysOfWorking = useCallback(
    (waysOfWorking: WorkspaceDataState["waysOfWorking"]) => {
      if (!workspaceId) return;
      setData((current) => {
        const next = { ...current, waysOfWorking };
        workspaceDataCache.set(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );
  const saveWaysOfWorking = useWaysOfWorkingSaver({
    capability,
    client,
    cloudOrganizationId,
    onSaved: applyWaysOfWorking,
    sessionToken,
    workspaceId,
  });
  const applyRecurringWork = useCallback(
    (work: RecurringWorkRecord) => {
      if (!workspaceId) return;
      setData((current) => {
        const recurringWork = current.recurringWork.map((item) =>
          item.id === work.id ? work : item,
        );
        const next = { ...current, recurringWork };
        workspaceDataCache.set(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );
  const recurringWorkSettings = useRecurringWorkSettings({
    capability,
    client,
    cloudOrganizationId,
    onSaved: applyRecurringWork,
    workspaceId,
  });
  const runMissionControlHeartbeatNow = useManualMissionHeartbeat({
    capability,
    client,
    cloudOrganizationId,
    workspaceId,
  });

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const clockInterval = window.setInterval(updateClock, 5_000);
    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") updateClock();
    };
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateWhenVisible);
    return () => {
      window.clearInterval(clockInterval);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener("visibilitychange", updateWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (dataWorkspaceRef.current !== workspaceId) {
      dataWorkspaceRef.current = workspaceId;
      workspaceRevisionRef.current = 0;
      const cached = workspaceId
        ? workspaceDataCache.get(workspaceId)
        : undefined;
      setData(
        workspaceId
          ? mergePendingOnboardingSchedules(
              workspaceId,
              cached ?? emptyWorkspaceData,
            )
          : emptyWorkspaceData,
      );
      setLoading(!cached);
    }
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    // Runtime revisions restart from one after a process reconnect.
    workspaceRevisionRef.current = 0;
    let pendingOnboardingRequestId: string | null = null;
    let pendingOnboardingRetryTimer: number | undefined;
    let pendingOnboardingRetryAttempt = 0;
    const clearPendingOnboardingRetry = () => {
      if (pendingOnboardingRetryTimer === undefined) return;
      window.clearTimeout(pendingOnboardingRetryTimer);
      pendingOnboardingRetryTimer = undefined;
    };
    const replayPendingOnboarding = () => {
      clearPendingOnboardingRetry();
      if (!relayNeedsPendingOnboardingReplay(workspaceId, relaySnapshot)) {
        completePendingOnboardingWork(workspaceId);
        pendingOnboardingRequestId = null;
        return;
      }
      const stored = readPendingOnboardingWork(workspaceId);
      if (!stored) {
        pendingOnboardingRequestId = null;
        return;
      }
      try {
        const pending = parsePendingOnboardingBootstrap(stored);
        if (!pending) {
          throw new Error("Invalid pending onboarding payload.");
        }
        pendingOnboardingRequestId = crypto.randomUUID();
        client.send({
          type: "bootstrapOnboardingWork",
          workspaceId,
          requestId: pendingOnboardingRequestId,
          jobs: pending.jobs,
          schedules: pending.schedules,
          workspaceContext: pending.workspaceContext,
          driver: pending.driver,
          model: pending.model,
          executorCapability: capability,
        });
        pendingOnboardingRetryTimer = window.setTimeout(
          replayPendingOnboarding,
          120_000,
        );
      } catch {
        window.localStorage.removeItem(
          pendingOnboardingWorkStorageKey(workspaceId),
        );
        pendingOnboardingRequestId = null;
      }
    };
    const retryPendingOnboarding = () => {
      clearPendingOnboardingRetry();
      pendingOnboardingRequestId = null;
      pendingOnboardingRetryTimer = window.setTimeout(
        replayPendingOnboarding,
        Math.min(30_000, 2_000 * 2 ** pendingOnboardingRetryAttempt),
      );
      pendingOnboardingRetryAttempt = Math.min(
        pendingOnboardingRetryAttempt + 1,
        4,
      );
    };
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceData" &&
        message.workspaceId === workspaceId
      ) {
        if (message.revision <= workspaceRevisionRef.current) return;
        workspaceRevisionRef.current = message.revision;
        const normalized = normalizeWorkspaceData(message);
        const next = mergePendingOnboardingSchedules(workspaceId, normalized);
        workspaceDataCache.set(workspaceId, next);
        setData(next);
        setLoading(false);
      }
      if (
        message.type === "actionRequestResolved" &&
        message.workspaceId === workspaceId
      ) {
        const pending = pendingActionRequestsRef.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingActionRequestsRef.current.delete(message.requestId);
          pending.resolve();
        }
        setData((current) => {
          const next = {
            ...current,
            actionItems: message.action
              ? [
                  message.action,
                  ...current.actionItems.filter(
                    (item) => item.id !== message.actionItemId,
                  ),
                ]
              : current.actionItems.filter(
                  (item) => item.id !== message.actionItemId,
                ),
          };
          workspaceDataCache.set(workspaceId, next);
          return next;
        });
      }
      if (message.type === "error" && message.requestId) {
        const pending = pendingActionRequestsRef.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingActionRequestsRef.current.delete(message.requestId);
          const error = new Error(message.message);
          toast.error(error.message);
          pending.reject(error);
        }
      }
      if (
        message.type === "onboardingWorkBootstrapped" &&
        message.workspaceId === workspaceId &&
        message.requestId === pendingOnboardingRequestId
      ) {
        clearPendingOnboardingRetry();
        pendingOnboardingRequestId = null;
        pendingOnboardingRetryAttempt = 0;
        completePendingOnboardingWork(workspaceId);
      }
      if (
        message.type === "error" &&
        message.requestId === pendingOnboardingRequestId
      ) {
        if (message.code === "deployment_not_found") {
          clearPendingOnboardingRetry();
          pendingOnboardingRequestId = null;
        } else {
          retryPendingOnboarding();
        }
      }
    });
    const refresh = () => {
      client.send({
        type: "listWorkspaceData",
        workspaceId,
        executorCapability: capability,
      });
    };
    refresh();
    replayPendingOnboarding();
    return () => {
      clearPendingOnboardingRetry();
      unsubscribe();
    };
  }, [
    capability,
    client,
    cloudOrganizationId,
    relaySnapshot,
    status,
    workspaceId,
  ]);

  return {
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
  };
}
