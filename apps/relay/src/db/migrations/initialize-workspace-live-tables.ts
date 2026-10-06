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
    CREATE TABLE IF NOT EXISTS conversation_activity (
      conversation_id TEXT PRIMARY KEY,
      last_message_at TEXT NOT NULL
    );
    -- One-time backfill from the retained live feed when the table is new.
    INSERT OR IGNORE INTO conversation_activity (conversation_id, last_message_at)
      SELECT conversation_id,
        MAX(json_extract(event_json, '$.payload.message.createdAt'))
      FROM workspace_live_events
      WHERE json_extract(event_json, '$.type') = 'conversation.message.appended'
        AND NOT EXISTS (SELECT 1 FROM conversation_activity)
      GROUP BY conversation_id;
  `);
}
