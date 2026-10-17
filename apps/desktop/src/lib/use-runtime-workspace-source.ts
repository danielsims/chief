import { useEffect, useRef, useState } from "react";

import type { WorkspaceDataState } from "./workspace-data";
/** Durable NIP-29 events for channel timelines and message search. */
import { useRuntime } from "./runtime-provider";
import { workspaceDataCache } from "./runtime-workspace-hooks";
import { useWorkspaceCapability } from "./workspace-capability";
import { emptyWorkspaceData, normalizeWorkspaceData } from "./workspace-data";

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

export function useRuntimeWorkspaceSource(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  // Loading means "no data has ever resolved for this workspace". The cache
  // spans mounts, so navigating back to a page shows the last data at once
  // and revalidates in place instead of flashing empty or placeholder frames.
  const [data, setData] = useState<WorkspaceDataState>(() =>
    workspaceId
      ? (workspaceDataCache.get(workspaceId) ?? emptyWorkspaceData)
      : emptyWorkspaceData,
  );
  const [loading, setLoading] = useState(
    () => !(workspaceId && workspaceDataCache.has(workspaceId)),
  );
  const [now, setNow] = useState(() => Date.now());
  const dataWorkspaceRef = useRef<string | null>(workspaceId);
  const workspaceRevisionRef = useRef(0);

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
      setData(cached ?? emptyWorkspaceData);
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
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceData" &&
        message.workspaceId === workspaceId
      ) {
        if (message.revision <= workspaceRevisionRef.current) return;
        workspaceRevisionRef.current = message.revision;
        const next = normalizeWorkspaceData(message);
        workspaceDataCache.set(workspaceId, next);
        setData(next);
        setLoading(false);
      }
    });
    client.send({
      type: "listWorkspaceData",
      workspaceId,
      executorCapability: capability,
    });
    return unsubscribe;
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return {
    capability,
    client,
    cloudOrganizationId,
    data,
    loading,
    now,
    setData,
    status,
  };
}
