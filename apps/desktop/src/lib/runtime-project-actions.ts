import { useCallback, useEffect, useState } from "react";

import type {
  ProjectAccessRequestRecord,
  ProviderPullRequest,
  ServerMessage,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

/** Publish and discard actions for one owned checkout. */
export function useProjectCheckoutActions() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waitForResult = useCallback(
    (requestId: string, types: string[]) =>
      new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("Chief did not finish this operation in time."));
        }, 120_000);
        const unsubscribe = client.subscribe((message: ServerMessage) => {
          if (
            "requestId" in message &&
            message.requestId === requestId &&
            types.includes(message.type)
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve();
          } else if (
            message.type === "error" &&
            message.requestId === requestId
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            reject(new Error(message.message));
          }
        });
      }),
    [client],
  );

  const run = useCallback(
    async (
      message:
        | {
            type: "publishProjectCheckout";
            checkoutId: string;
            targetBranch?: string;
          }
        | {
            type: "discardProjectCheckout";
            checkoutId: string;
            confirmed: boolean;
          },
      types: string[],
    ) => {
      if (!cloudOrganizationId || !capability || status !== "connected") {
        return false;
      }
      const requestId = crypto.randomUUID();
      setBusy(true);
      setError(null);
      try {
        const pending = waitForResult(requestId, types);
        client.send({
          ...message,
          requestId,
          workspaceId: cloudOrganizationId,
          executorCapability: capability,
        });
        await pending;
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [capability, client, cloudOrganizationId, status, waitForResult],
  );

  const publish = useCallback(
    (checkoutId: string, input?: { targetBranch?: string }) =>
      run(
        {
          type: "publishProjectCheckout",
          checkoutId,
          ...(input?.targetBranch ? { targetBranch: input.targetBranch } : {}),
        },
        ["projectPublished"],
      ),
    [run],
  );

  const discard = useCallback(
    (checkoutId: string) =>
      run({ type: "discardProjectCheckout", checkoutId, confirmed: true }, [
        "projectCheckoutDiscarded",
      ]),
    [run],
  );

  return { busy, error, clearError: () => setError(null), publish, discard };
}

/** Creates a provider pull request and returns the created record. */
export function useProjectPullRequest() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProviderPullRequest | null>(null);

  const create = useCallback(
    async (
      projectId: string,
      input: {
        title: string;
        description?: string;
        headBranch: string;
        baseBranch: string;
      },
    ) => {
      if (!cloudOrganizationId || !capability || status !== "connected") {
        return false;
      }
      const requestId = crypto.randomUUID();
      setBusy(true);
      setError(null);
      setCreated(null);
      return new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          unsubscribe();
          setBusy(false);
          setError("Chief did not finish creating the pull request in time.");
          resolve(false);
        }, 120_000);
        const unsubscribe = client.subscribe((message: ServerMessage) => {
          if (
            message.type === "projectPullRequestCreated" &&
            message.requestId === requestId &&
            message.workspaceId === cloudOrganizationId
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            setCreated(message.pullRequest);
            setBusy(false);
            resolve(true);
          } else if (
            message.type === "error" &&
            message.requestId === requestId
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            setError(message.message);
            setBusy(false);
            resolve(false);
          }
        });
        client.send({
          type: "createProjectPullRequest",
          workspaceId: cloudOrganizationId,
          requestId,
          projectId,
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          headBranch: input.headBranch,
          baseBranch: input.baseBranch,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, status],
  );

  return {
    busy,
    error,
    created,
    clearError: () => setError(null),
    create,
  };
}

/** Pending agent access requests and their approve/deny decisions. */
export function useProjectAccessRequests() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [received, setReceived] = useState<{
    workspaceId: string;
    requests: ProjectAccessRequestRecord[];
  } | null>(null);
  const requests =
    cloudOrganizationId && received?.workspaceId === cloudOrganizationId
      ? received.requests
      : null;
  const [busy, setBusy] = useState<{
    workspaceId: string;
    requestId: string;
  } | null>(null);
  const busyId =
    cloudOrganizationId && busy?.workspaceId === cloudOrganizationId
      ? busy.requestId
      : null;
  const [failure, setFailure] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);
  const error =
    cloudOrganizationId && failure?.workspaceId === cloudOrganizationId
      ? failure.message
      : null;

  useEffect(() => {
    if (!cloudOrganizationId) return;
    const unsubscribe = client.subscribe((message: ServerMessage) => {
      if (
        message.type === "projectAccessRequests" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setReceived({
          workspaceId: cloudOrganizationId,
          requests: message.requests,
        });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [client, cloudOrganizationId]);

  const refresh = useCallback(() => {
    if (!cloudOrganizationId || !capability || status !== "connected") return;
    client.send({
      type: "listProjectAccessRequests",
      workspaceId: cloudOrganizationId,
      executorCapability: capability,
    });
  }, [capability, client, cloudOrganizationId, status]);

  const resolve = useCallback(
    (requestId: string, decision: "approved" | "denied") => {
      if (!cloudOrganizationId || !capability || status !== "connected") return;
      setBusy({ workspaceId: cloudOrganizationId, requestId });
      setFailure(null);
      const requestToken = crypto.randomUUID();
      const unsubscribe = client.subscribe((message: ServerMessage) => {
        if (
          message.type === "projectAccessRequestResolved" &&
          message.requestId === requestToken &&
          message.workspaceId === cloudOrganizationId
        ) {
          unsubscribe();
          setBusy(null);
          setReceived((current) =>
            current?.workspaceId === cloudOrganizationId
              ? {
                  ...current,
                  requests: current.requests.filter(
                    (request) => request.id !== requestId,
                  ),
                }
              : current,
          );
        } else if (
          message.type === "error" &&
          message.requestId === requestToken
        ) {
          unsubscribe();
          setBusy(null);
          setFailure({
            workspaceId: cloudOrganizationId,
            message: message.message,
          });
        }
      });
      client.send({
        type: "resolveProjectAccessRequest",
        workspaceId: cloudOrganizationId,
        requestId: requestToken,
        accessRequestId: requestId,
        decision,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId, status],
  );

  return {
    requests,
    loading: requests === null,
    error,
    clearError: () => setFailure(null),
    refresh,
    approve: (requestId: string) => resolve(requestId, "approved"),
    deny: (requestId: string) => resolve(requestId, "denied"),
    busyId,
  };
}
