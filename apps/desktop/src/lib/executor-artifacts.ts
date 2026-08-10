import { useEffect, useRef, useState } from "react";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

const artifactsCache = new Map<string, ExecutorArtifactSummary[]>();

/** Model-created interfaces persisted by this workspace's Executor daemon. */
export function useExecutorArtifacts(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [artifacts, setArtifacts] = useState<ExecutorArtifactSummary[]>(() =>
    workspaceId ? (artifactsCache.get(workspaceId) ?? []) : [],
  );
  const [resolved, setResolved] = useState(() =>
    Boolean(workspaceId && artifactsCache.has(workspaceId)),
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const artifactsWorkspaceRef = useRef<string | null>(workspaceId);

  useEffect(() => {
    if (artifactsWorkspaceRef.current !== workspaceId) {
      artifactsWorkspaceRef.current = workspaceId;
      setArtifacts(workspaceId ? (artifactsCache.get(workspaceId) ?? []) : []);
      setResolved(Boolean(workspaceId && artifactsCache.has(workspaceId)));
      setError(null);
    }
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "artifacts" && message.workspaceId === workspaceId) {
        const next = [...message.artifacts].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        );
        artifactsCache.set(workspaceId, next);
        setArtifacts(next);
        setResolved(true);
        setError(null);
      }
    });
    const refresh = () =>
      client.send({
        type: "listArtifacts",
        workspaceId,
        executorCapability: capability,
      });
    refresh();
    const responseTimer = window.setTimeout(() => {
      setResolved(true);
      setError("The local artifact service is still starting.");
    }, 20_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(responseTimer);
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [attempt, capability, client, cloudOrganizationId, status, workspaceId]);

  return {
    artifacts,
    loading: !resolved,
    error,
    retry: () => {
      setResolved(false);
      setError(null);
      setAttempt((value) => value + 1);
    },
  };
}
