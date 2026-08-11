import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type {
  ClientMessage,
  ExecutorCapability,
  ServerMessage,
  WorkspaceOperatingMode,
  WorkspaceWaysOfWorking,
} from "@chief/agent-runtime/types";

interface WaysOfWorkingClient {
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}

/** Saves the lightweight operating preference and owns its runtime ack. */
export function useWaysOfWorkingSaver({
  capability,
  client,
  cloudOrganizationId,
  onSaved,
  sessionToken,
  workspaceId,
}: {
  capability: ExecutorCapability | null;
  client: WaysOfWorkingClient;
  cloudOrganizationId: string | null;
  onSaved: (waysOfWorking: WorkspaceWaysOfWorking) => void;
  sessionToken: string | null;
  workspaceId: string | null;
}) {
  const pending = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: number;
      }
    >(),
  );

  useEffect(
    () =>
      client.subscribe((message) => {
        if (
          message.type === "workspaceWaysOfWorkingSaved" &&
          message.workspaceId === workspaceId
        ) {
          onSaved(message.waysOfWorking);
          const request = pending.current.get(message.requestId);
          if (!request) return;
          window.clearTimeout(request.timer);
          pending.current.delete(message.requestId);
          request.resolve();
          return;
        }
        if (message.type !== "error" || !message.requestId) return;
        const request = pending.current.get(message.requestId);
        if (!request) return;
        window.clearTimeout(request.timer);
        pending.current.delete(message.requestId);
        const error = new Error(message.message);
        toast.error(error.message);
        request.reject(error);
      }),
    [client, onSaved, workspaceId],
  );

  return useCallback(
    (mode: WorkspaceOperatingMode, missionControlChannelId: string) => {
      if (
        !workspaceId ||
        workspaceId !== cloudOrganizationId ||
        !capability ||
        !sessionToken
      ) {
        return Promise.reject(
          new Error("Chief is still authorizing this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.current.delete(requestId);
          reject(new Error("Chief could not save this way of working."));
        }, 8_000);
        pending.current.set(requestId, { resolve, reject, timer });
        client.send({
          type: "saveWorkspaceWaysOfWorking",
          workspaceId,
          requestId,
          mode,
          missionControlChannelId,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken, workspaceId],
  );
}
