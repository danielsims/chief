import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  ClientMessage,
  ExecutorCapability,
  RecurringWorkRecord,
  ServerMessage,
} from "@chief/agent-runtime/types";

interface RuntimeClient {
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}

interface WebhookResult {
  url: string;
  reachability: "local_only";
}
type PendingRequest =
  | {
      kind: "save";
      resolve: (work: RecurringWorkRecord) => void;
      reject: (error: Error) => void;
      timer: number;
    }
  | {
      kind: "webhook";
      resolve: (result: WebhookResult) => void;
      reject: (error: Error) => void;
      timer: number;
    };

/** Owns acknowledged recurring-work edits and one-time webhook credentials. */
export function useRecurringWorkSettings({
  capability,
  client,
  cloudOrganizationId,
  onSaved,
  workspaceId,
}: {
  capability: ExecutorCapability | null;
  client: RuntimeClient;
  cloudOrganizationId: string | null;
  onSaved: (work: RecurringWorkRecord) => void;
  workspaceId: string | null;
}) {
  const pending = useRef(new Map<string, PendingRequest>());

  useEffect(
    () =>
      client.subscribe((message) => {
        if (
          message.type === "recurringWorkSaved" &&
          message.workspaceId === workspaceId
        ) {
          onSaved(message.work);
          const request = pending.current.get(message.requestId);
          if (request?.kind !== "save") return;
          window.clearTimeout(request.timer);
          pending.current.delete(message.requestId);
          request.resolve(message.work);
          return;
        }
        if (
          message.type === "recurringWorkWebhookRotated" &&
          message.workspaceId === workspaceId
        ) {
          const request = pending.current.get(message.requestId);
          if (request?.kind !== "webhook") return;
          window.clearTimeout(request.timer);
          pending.current.delete(message.requestId);
          request.resolve({
            url: message.url,
            reachability: message.reachability,
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
    [client, onSaved, workspaceId],
  );

  useEffect(
    () => () => {
      for (const request of pending.current.values()) {
        window.clearTimeout(request.timer);
        request.reject(new Error("Chief closed this settings view."));
      }
      pending.current.clear();
    },
    [],
  );

  const requireConnection = useCallback(() => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      throw new Error("Chief is still authorizing this workspace.");
    }
    return { workspaceId, executorCapability: capability };
  }, [capability, cloudOrganizationId, workspaceId]);

  const save = useCallback(
    (work: RecurringWorkRecord) => {
      const connection = requireConnection();
      const requestId = crypto.randomUUID();
      return new Promise<RecurringWorkRecord>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.current.delete(requestId);
          reject(new Error("Chief could not save this schedule."));
        }, 10_000);
        pending.current.set(requestId, {
          kind: "save",
          resolve,
          reject,
          timer,
        });
        client.send({
          type: "saveRecurringWork",
          requestId,
          work,
          ...connection,
        });
      });
    },
    [client, requireConnection],
  );

  const rotateWebhook = useCallback(
    (recurringWorkId: string) => {
      const connection = requireConnection();
      const requestId = crypto.randomUUID();
      return new Promise<WebhookResult>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.current.delete(requestId);
          reject(new Error("Chief could not generate a webhook URL."));
        }, 10_000);
        pending.current.set(requestId, {
          kind: "webhook",
          resolve,
          reject,
          timer,
        });
        client.send({
          type: "rotateRecurringWorkWebhook",
          requestId,
          recurringWorkId,
          ...connection,
        });
      });
    },
    [client, requireConnection],
  );

  return useMemo(() => ({ save, rotateWebhook }), [rotateWebhook, save]);
}
