export function initializeProjectTables<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      agent_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      repository_kind TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      canonical_remote_url TEXT,
      repository_web_url TEXT,
      repository_files_json TEXT,
      default_branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_remote_unique
      ON projects (canonical_remote_url)
      WHERE canonical_remote_url IS NOT NULL;
    CREATE INDEX IF NOT EXISTS projects_updated_idx
      ON projects (updated_at DESC);
    CREATE TABLE IF NOT EXISTS project_store_migrations (
      migration_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_repositories (
      repository_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      provider_id TEXT NOT NULL,
      canonical_remote_url TEXT NOT NULL,
      provider_repository_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `);
}
