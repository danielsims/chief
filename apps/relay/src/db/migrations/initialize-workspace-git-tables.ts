/**
 * The workspace's own Git host. Objects are content-addressed and immutable;
 * refs are the only mutable state. Everything lives in the workspace Durable
 * Object's SQLite database, so a self-hosted relay needs no external Git
 * service.
 */
export function initializeWorkspaceGitTables(storage: DurableObjectStorage) {
  return storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS workspace_git_objects (
      repo TEXT NOT NULL,
      sha TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      payload BLOB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (repo, sha)
    );
    CREATE TABLE IF NOT EXISTS workspace_git_refs (
      repo TEXT NOT NULL,
      ref TEXT NOT NULL,
      sha TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (repo, ref)
    );
    CREATE TABLE IF NOT EXISTS workspace_git_commits (
      repo TEXT NOT NULL,
      sha TEXT NOT NULL,
      message TEXT NOT NULL,
      author_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (repo, sha)
    );
  `);
}
