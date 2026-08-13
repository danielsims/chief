import { useCallback, useEffect, useRef } from "react";

import type {
  ClientMessage,
  ExecutorCapability,
  ServerMessage,
} from "@chief/agent-runtime/types";

interface RuntimeClient {
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}

export interface ManualHeartbeatTarget {
  channelId: string;
  messageId: string;
  threadRootId: string;
}

/** Starts a visible mission-control thread and resolves its navigation target. */
export function useManualMissionHeartbeat({
  capability,
  client,
  cloudOrganizationId,
  workspaceId,
}: {
  capability: ExecutorCapability | null;
  client: RuntimeClient;
  cloudOrganizationId: string | null;
  workspaceId: string | null;
}) {
  const pending = useRef(
    new Map<
      string,
      {
        resolve: (target: ManualHeartbeatTarget) => void;
        reject: (error: Error) => void;
        timer: number;
      }
    >(),
  );

  useEffect(
    () =>
      client.subscribe((message) => {
        if (
          message.type === "missionControlHeartbeatStarted" &&
          message.workspaceId === workspaceId
        ) {
          const request = pending.current.get(message.requestId);
          if (!request) return;
          window.clearTimeout(request.timer);
          pending.current.delete(message.requestId);
          request.resolve({
            channelId: message.channelId,
            messageId: message.messageId,
            threadRootId: message.threadRootId,
          });
          return;
        }
        if (message.type !== "error" || !message.requestId) return;
        const request = pending.current.get(message.requestId);
        if (!request) return;
        window.clearTimeout(request.timer);
        pending.current.delete(message.requestId);
        request.reject(new Error(message.message));
      }),
    [client, workspaceId],
  );

  useEffect(() => () => {
    for (const request of pending.current.values()) {
      window.clearTimeout(request.timer);
      request.reject(new Error("Chief closed this settings view."));
    }
    pending.current.clear();
  });

  return useCallback(() => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return Promise.reject(
        new Error("Chief is still authorizing this workspace."),
      );
    }
    const requestId = crypto.randomUUID();
    return new Promise<ManualHeartbeatTarget>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("Chief could not start this check."));
      }, 10_000);
      pending.current.set(requestId, { resolve, reject, timer });
      client.send({
        type: "runMissionControlHeartbeatNow",
        workspaceId,
        requestId,
        executorCapability: capability,
      });
    });
  }, [capability, client, cloudOrganizationId, workspaceId]);
}
