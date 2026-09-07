export function initializeAccountTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
        CREATE TABLE IF NOT EXISTS workspace_directory_v2 (
          workspace_id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          website TEXT NOT NULL DEFAULT '',
          create_command_json TEXT,
          created_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_v2
          ON workspace_directory_v2 (active) WHERE active = 1;
        CREATE TABLE IF NOT EXISTS device_active_workspaces (
          device_pubkey TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS push_devices (
          token TEXT PRIMARY KEY,
          environment TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
}
