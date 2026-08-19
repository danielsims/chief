import type {
  LogBatch,
  LogPage,
  LogRecord,
  WorkspaceId,
} from "@chief/relay-contracts";
import { logPageSchema, workspaceIdSchema } from "@chief/relay-contracts";

interface LogRow extends Record<string, SqlStorageValue> {
  sequence: number;
  workspace_id: string;
  log_id: string;
  correlation_id: string;
  type: LogRecord["type"];
  operation: string;
  deployment: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  message: string;
  payload_json: string | null;
  created_at: string;
}

export function initializeWorkspaceLog(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS log (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      log_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      operation TEXT NOT NULL,
      deployment TEXT,
      agent_id TEXT,
      conversation_id TEXT,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, log_id)
    );
    CREATE INDEX IF NOT EXISTS log_timeline
      ON log (workspace_id, sequence DESC);
  `);
}

export function appendWorkspaceLogs(
  storage: DurableObjectStorage,
  batch: LogBatch,
) {
  storage.transactionSync(() => {
    for (const entry of batch.logs) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO log (
          workspace_id, log_id, correlation_id, type, operation, deployment,
          agent_id, conversation_id, message, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.workspaceId,
        entry.id,
        entry.correlationId,
        entry.type,
        entry.operation,
        entry.deployment ?? null,
        entry.agentId ?? null,
        entry.conversationId ?? null,
        entry.message,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.createdAt,
      );
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
      ? storage.sql.exec(
          `SELECT * FROM log WHERE workspace_id = ? AND sequence < ?
           ORDER BY sequence DESC LIMIT ?`,
          workspaceId,
          cursor,
          limit,
        )
      : storage.sql.exec(
          `SELECT * FROM log WHERE workspace_id = ?
           ORDER BY sequence DESC LIMIT ?`,
          workspaceId,
          limit,
        )
  ).toArray() as LogRow[];
  const logs = rows.map((row) => ({
    id: String(row.log_id),
    correlationId: String(row.correlation_id),
    workspaceId: workspaceIdSchema.parse(String(row.workspace_id)),
    type: String(row.type) as LogRecord["type"],
    operation: String(row.operation),
    ...(row.deployment ? { deployment: String(row.deployment) } : {}),
    ...(row.agent_id ? { agentId: String(row.agent_id) } : {}),
    ...(row.conversation_id
      ? { conversationId: String(row.conversation_id) }
      : {}),
    message: String(row.message),
    ...(row.payload_json
      ? { metadata: parseStoredJson(String(row.payload_json)) }
      : {}),
    createdAt: String(row.created_at),
  }));
  const last = rows.at(-1);
  const nextCursor =
    rows.length === limit && last ? String(last.sequence) : undefined;
  return logPageSchema.parse({
    logs,
    ...(nextCursor ? { nextCursor } : {}),
  });
}

function parseStoredJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
