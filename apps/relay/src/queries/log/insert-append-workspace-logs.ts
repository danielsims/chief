import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { log } from "../../db/schema/log";

export function logInsertAppendWorkspaceLogs(
  storage: DurableObjectStorage,
  {
    workspaceId,
    logId,
    correlationId,
    type,
    operation,
    deployment,
    agentId,
    conversationId,
    message,
    payloadJson,
    createdAt,
  }: {
    workspaceId: string;
    logId: string;
    correlationId: string;
    type: string;
    operation: string;
    deployment: string | null;
    agentId: string | null;
    conversationId: string | null;
    message: string;
    payloadJson: string | null;
    createdAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(log)
        .values({
          workspace_id: workspaceId,
          log_id: logId,
          correlation_id: correlationId,
          type: type,
          operation: operation,
          deployment: deployment,
          agent_id: agentId,
          conversation_id: conversationId,
          message: message,
          payload_json: payloadJson,
          created_at: createdAt,
        })
        .onConflictDoNothing(),
    ),
  );
}
