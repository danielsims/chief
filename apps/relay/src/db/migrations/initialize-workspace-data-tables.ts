export function initializeWorkspaceDataTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    CREATE TABLE IF NOT EXISTS brand_profile (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      markdown TEXT NOT NULL,
      source_urls_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      author_agent_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_files (
      file_id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prospects (
      prospect_id TEXT PRIMARY KEY,
      prospect_json TEXT NOT NULL,
      relevance TEXT NOT NULL,
      found_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prospects_recent_idx
      ON prospects (updated_at DESC);
    DROP TABLE IF EXISTS board_items;
    DROP TABLE IF EXISTS board_lanes;
    CREATE TABLE IF NOT EXISTS databases (
      database_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      database_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS database_rows (
      row_id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS database_rows_database_idx
      ON database_rows (database_id);
  `);
}
