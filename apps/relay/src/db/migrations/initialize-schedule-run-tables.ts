export function initializeScheduleRunTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql
    .exec<Row>(`CREATE TABLE IF NOT EXISTS workspace_schedule_runs (
    id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, state TEXT NOT NULL,
    next_check_at INTEGER, created_at INTEGER NOT NULL, document_json TEXT NOT NULL, principal_json TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS schedule_runs_due ON workspace_schedule_runs(next_check_at);
  CREATE INDEX IF NOT EXISTS schedule_runs_history ON workspace_schedule_runs(schedule_id, created_at);
  CREATE TABLE IF NOT EXISTS workspace_schedule_webhooks (
    id TEXT PRIMARY KEY, document_json TEXT NOT NULL, secret TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS workspace_webhook_deliveries (
    webhook_id TEXT NOT NULL, delivery_id TEXT NOT NULL, body_hash TEXT NOT NULL, run_id TEXT NOT NULL,
    received_at INTEGER NOT NULL, PRIMARY KEY(webhook_id, delivery_id)
  );`);
}
