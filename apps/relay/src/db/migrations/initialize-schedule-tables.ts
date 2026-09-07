export function initializeScheduleTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`CREATE TABLE IF NOT EXISTS workspace_schedules (
    id TEXT PRIMARY KEY, document_json TEXT NOT NULL, next_at INTEGER
  ); CREATE TABLE IF NOT EXISTS workspace_schedule_commands (command_id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, action TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace_schedule_dispatches (
    id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL,
    command_id TEXT NOT NULL, message_id TEXT NOT NULL, state TEXT NOT NULL,
    retry_at INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  ); CREATE INDEX IF NOT EXISTS workspace_schedule_due ON workspace_schedules(next_at);
  CREATE INDEX IF NOT EXISTS workspace_schedule_dispatch_due ON workspace_schedule_dispatches(state, retry_at);`);
}
