import { z } from "zod";

import type { LogBatch, LogPage, WorkspaceId } from "@chief/relay-contracts";
import {
  logPageSchema,
  logTypeSchema,
  parseJsonValue,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { initializeWorkspaceLog as initializeWorkspaceLogTable } from "./db/migrations/initialize-workspace-log";
import { logFindReadWorkspaceLogs } from "./queries/log/find-read-workspace-logs";
import { logFindReadWorkspaceLogsWorkspaceId } from "./queries/log/find-read-workspace-logs-workspace-id";
import { logInsertAppendWorkspaceLogs } from "./queries/log/insert-append-workspace-logs";

const storedLogRowSchema = z.object({
  sequence: z.number().int(),
  workspace_id: z.string(),
  log_id: z.string(),
  correlation_id: z.string(),
  type: logTypeSchema,
  operation: z.string(),
  deployment: z.string().nullable(),
  agent_id: z.string().nullable(),
  conversation_id: z.string().nullable(),
  message: z.string(),
  payload_json: z.string().nullable(),
  created_at: z.string(),
});

export function initializeWorkspaceLog(storage: DurableObjectStorage) {
  initializeWorkspaceLogTable(storage);
}

export function appendWorkspaceLogs(
  storage: DurableObjectStorage,
  batch: LogBatch,
) {
  storage.transactionSync(() => {
    for (const entry of batch.logs) {
      logInsertAppendWorkspaceLogs(storage, {
        workspaceId: entry.workspaceId,
        logId: entry.id,
        correlationId: entry.correlationId,
        type: entry.type,
        operation: entry.operation,
        deployment: entry.deployment ?? null,
        agentId: entry.agentId ?? null,
        conversationId: entry.conversationId ?? null,
        message: entry.message,
        payloadJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
        createdAt: entry.createdAt,
      });
    }
  });
}

export function readWorkspaceLogs(
  storage: DurableObjectStorage,
  workspaceId: WorkspaceId,
  url: URL,
): LogPage {
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1),
    200,
  );
  const cursor = Number(url.searchParams.get("cursor") ?? 0);
  const rows = (
    cursor > 0
      ? logFindReadWorkspaceLogs(storage, {
          workspaceId: workspaceId,
          sequence: cursor,
          limit: limit,
        })
      : logFindReadWorkspaceLogsWorkspaceId(storage, workspaceId, limit)
  ).map((row) => storedLogRowSchema.parse(row));
  const logs = rows.map((row) => ({
    id: String(row.log_id),
    correlationId: String(row.correlation_id),
    workspaceId: workspaceIdSchema.parse(String(row.workspace_id)),
    type: row.type,
    operation: String(row.operation),
    ...(row.deployment ? { deployment: String(row.deployment) } : undefined),
    ...(row.agent_id ? { agentId: String(row.agent_id) } : undefined),
    ...(row.conversation_id
      ? { conversationId: String(row.conversation_id) }
      : undefined),
    message: String(row.message),
    ...(row.payload_json
      ? { metadata: parseStoredJson(String(row.payload_json)) }
      : undefined),
    createdAt: String(row.created_at),
  }));
  const last = rows.at(-1);
  const nextCursor =
    rows.length === limit && last ? String(last.sequence) : undefined;
  return logPageSchema.parse({
    logs,
    ...(nextCursor ? { nextCursor } : undefined),
  });
}

function parseStoredJson(value: string) {
  return parseJsonValue(JSON.parse(value)) ?? null;
}
