import { useEffect, useState } from "react";

import type { WorkspaceEnvironmentVariable } from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useWorkspaceEnvironmentVariables() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [requestAttempt, setRequestAttempt] = useState(0);
  const [variableState, setVariableState] = useState<{
    workspaceId: string;
    variables: WorkspaceEnvironmentVariable[];
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);
  const variables =
    variableState?.workspaceId === cloudOrganizationId
      ? variableState.variables
      : null;
  const error =
    errorState?.workspaceId === cloudOrganizationId ? errorState.message : null;

  useEffect(() => {
    if (status !== "connected" || !cloudOrganizationId || !capability) {
      return;
    }
    let resolved = false;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceEnvironmentVariables" &&
        message.workspaceId === cloudOrganizationId
      ) {
        resolved = true;
        setVariableState({
          workspaceId: message.workspaceId,
          variables: message.variables,
        });
        setErrorState(null);
      }
    });
    const requestVariables = () => {
      client.send({
        type: "listWorkspaceEnvironmentVariables",
        workspaceId: cloudOrganizationId,
        executorCapability: capability,
      });
    };
    requestVariables();
    const retryTimer = window.setTimeout(() => {
      if (!resolved) requestVariables();
    }, 1_500);
    const timeoutTimer = window.setTimeout(() => {
      if (resolved) return;
      setErrorState({
        workspaceId: cloudOrganizationId,
        message: "Chief could not reach the workspace vault.",
      });
    }, 6_000);
    return () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(timeoutTimer);
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, requestAttempt, status]);

  const save = (key: string, value: string) => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "saveWorkspaceEnvironmentVariable",
      workspaceId: cloudOrganizationId,
      key,
      value,
      executorCapability: capability,
    });
  };

  const remove = (key: string) => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "deleteWorkspaceEnvironmentVariable",
      workspaceId: cloudOrganizationId,
      key,
      executorCapability: capability,
    });
  };

  const refresh = () => {
    setErrorState(null);
    setRequestAttempt((attempt) => attempt + 1);
  };

  return {
    variables,
    error,
    refresh,
    save,
    remove,
    connected: status === "connected",
  };
}
