export function initializeWorkspaceLiveTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    CREATE TABLE IF NOT EXISTS workspace_live_counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO workspace_live_counters (name, value)
      VALUES ('sequence', 0);
    CREATE TABLE IF NOT EXISTS workspace_live_events (
      sequence INTEGER PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_live_events_conversation_idx
      ON workspace_live_events (conversation_id, sequence);
  `);
}
