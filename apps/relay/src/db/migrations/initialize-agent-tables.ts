export function initializeAgentTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      job_json TEXT NOT NULL,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      lease_token TEXT UNIQUE,
      lease_expires_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_claim_idx
      ON jobs (status, available_at, lease_expires_at);
    CREATE TABLE IF NOT EXISTS receipts (
      command_id TEXT PRIMARY KEY,
      job_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cell_records (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
