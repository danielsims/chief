import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";

import { useAuth } from "./auth/auth-context";
/** Durable NIP-29 events for channel timelines and message search. */
import { RuntimeCoreProvider } from "./runtime-provider";
import { workspaceDataCache } from "./runtime-workspace-hooks";
import { useRuntimeWorkspaceSource } from "./use-runtime-workspace-source";

export {
  messageBlocks,
  useAgentPreferences,
  useWorkspaceEnvironmentVariables,
  useWorkspaceFile,
  useWorkspaceFiles,
  type ChatControlState,
} from "./runtime-diagnostics";
export { useRuntime, type RuntimeStatus } from "./runtime-provider";
export {
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
    client,
    cloudOrganizationId,
    data,
    loading,
    now,
    setData,
  } = useRuntimeWorkspaceSource(workspaceId);
  const liveData = useMemo(
    () => ({
      ...data,
      recurringWork: data.recurringWork.map((work) => ({
        ...work,
        recordedRuns: [
          ...new Set([
            ...(work.recordedRuns ?? []),
            ...(work.upcomingRuns ?? []).filter(
              (timestamp) => timestamp <= now,
            ),
          ]),
        ],
        upcomingRuns: work.upcomingRuns?.filter((timestamp) => timestamp > now),
      })),
    }),
    [data, now],
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
    saveRecurringWork,
    runRecurringWorkNow,
    deleteRecurringWork,
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
