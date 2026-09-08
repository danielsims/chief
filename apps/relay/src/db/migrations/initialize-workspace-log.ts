export function initializeWorkspaceLog<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
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
