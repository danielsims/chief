export function initializeWorkspaceMachines<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    CREATE TABLE IF NOT EXISTS machines (
      machine_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      endpoint TEXT,
      capabilities_json TEXT NOT NULL,
      agent_ids_json TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS machines_updated_idx ON machines (updated_at DESC);
  `);
}
