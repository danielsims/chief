import { useCallback, useState } from "react";

import type { ServerMessage } from "@chief/agent-runtime/types";

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
