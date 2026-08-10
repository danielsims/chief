import { useEffect, useState } from "react";

import type {
  InputRequest,
  WorkspaceEnvironmentVariable,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useStoredInputs(keys: string[] | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [inputStatus, setInputStatus] = useState<{
    signature: string;
    present: ReadonlySet<string>;
  } | null>(null);
  const keysSignature = JSON.stringify(keys ?? []);
  const present =
    inputStatus?.signature === keysSignature ? inputStatus.present : null;

  useEffect(() => {
    const parsed = JSON.parse(keysSignature) as string[];
    if (
      parsed.length === 0 ||
      status !== "connected" ||
      !cloudOrganizationId ||
      !capability
    ) {
      return;
    }
    const unsub = client.subscribe((msg) => {
      if (
        msg.type === "inputsStatus" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        setInputStatus({
          signature: keysSignature,
          present: new Set(msg.present.filter((key) => parsed.includes(key))),
        });
      }
    });
    client.send({
      type: "queryInputs",
      workspaceId: cloudOrganizationId,
      keys: parsed,
      executorCapability: capability,
    });
    return () => {
      unsub();
    };
  }, [client, status, keysSignature, cloudOrganizationId, capability]);

  const store = (request: InputRequest, values: Record<string, string>) => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "storeInput",
      workspaceId: cloudOrganizationId,
      request,
      values,
      executorCapability: capability,
    });
  };

  return { present, store };
}

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
        message: "Chief could not reach the local credential vault.",
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

export function useDisconnectGoogleAnalytics() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();

  return () =>
    new Promise<void>((resolve, reject) => {
      if (status !== "connected" || !cloudOrganizationId || !capability) {
        reject(new Error("The local integration service is unavailable."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        unsubscribe();
        reject(new Error("Disconnecting Google Analytics timed out."));
      }, 15_000);
      const unsubscribe = client.subscribe((message) => {
        if (
          message.type === "integrationDisconnected" &&
          message.workspaceId === cloudOrganizationId &&
          message.requestId === requestId
        ) {
          window.clearTimeout(timeout);
          unsubscribe();
          resolve();
          return;
        }
        if (message.type === "error" && message.requestId === requestId) {
          window.clearTimeout(timeout);
          unsubscribe();
          reject(new Error(message.message));
        }
      });
      client.send({
        type: "disconnectGoogleAnalytics",
        workspaceId: cloudOrganizationId,
        requestId,
        executorCapability: capability,
      });
    });
}
