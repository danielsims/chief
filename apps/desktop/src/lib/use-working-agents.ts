import { useEffect, useMemo, useState } from "react";

import { useRuntime, useWorkspaceCapability } from "./runtime";

const noRuns: ReadonlyMap<string, number> = new Map();

/**
 * A run whose progress has gone quiet this long is treated as finished, so a
 * run that ends without any closing message cannot leave an agent spinning.
 */
export const WORKING_RUN_EXPIRY_MS = 10 * 60_000;

/** Runs in progress, keyed by channel, thread and agent, to when last seen. */
export function reduceWorkingRuns(
  current: ReadonlyMap<string, number>,
  change: {
    channelId: string;
    threadRootId?: string;
    agentId: string;
    working: boolean;
  },
  now: number,
): ReadonlyMap<string, number> {
  const key = [change.channelId, change.threadRootId ?? "", change.agentId]
    .map(encodeURIComponent)
    .join(":");
  if (!change.working && !current.has(key)) return current;
  const next = new Map(current);
  if (change.working) next.set(key, now);
  else next.delete(key);
  return next;
}

export function expireWorkingRuns(
  current: ReadonlyMap<string, number>,
  now: number,
): ReadonlyMap<string, number> {
  const next = new Map(
    [...current].filter(([, at]) => now - at < WORKING_RUN_EXPIRY_MS),
  );
  return next.size === current.size ? current : next;
}

export function workingAgentIdsFromRuns(runs: ReadonlyMap<string, number>) {
  return new Set(
    [...runs.keys()].map((key) =>
      decodeURIComponent(key.slice(key.lastIndexOf(":") + 1)),
    ),
  );
}

/** Agents with a run in progress anywhere in the workspace. */
export function useWorkingAgentIds(): ReadonlySet<string> {
  const { client } = useRuntime();
  const { cloudOrganizationId } = useWorkspaceCapability();
  // Keyed by workspace so switching workspaces starts empty.
  const [state, setState] = useState<{
    workspaceId: string | null;
    runs: ReadonlyMap<string, number>;
  }>({ workspaceId: cloudOrganizationId, runs: noRuns });
  const runs = state.workspaceId === cloudOrganizationId ? state.runs : noRuns;

  useEffect(() => {
    if (!cloudOrganizationId) return;
    return client.subscribe((message) => {
      if (
        message.type !== "agentWorking" ||
        message.workspaceId !== cloudOrganizationId
      )
        return;
      setState((current) => {
        const base =
          current.workspaceId === cloudOrganizationId ? current.runs : noRuns;
        const next = reduceWorkingRuns(base, message, Date.now());
        return next === base && current.workspaceId === cloudOrganizationId
          ? current
          : { workspaceId: cloudOrganizationId, runs: next };
      });
    });
  }, [client, cloudOrganizationId]);

  useEffect(() => {
    if (runs.size === 0) return;
    const timer = window.setInterval(() => {
      setState((current) => {
        const next = expireWorkingRuns(current.runs, Date.now());
        return next === current.runs ? current : { ...current, runs: next };
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [runs.size]);

  return useMemo(() => workingAgentIdsFromRuns(runs), [runs]);
}
