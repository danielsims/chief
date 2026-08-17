import { useCallback, useState } from "react";

import type {
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
