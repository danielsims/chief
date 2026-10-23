export function initializeMcpConnectionTables(storage: DurableObjectStorage) {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS mcp_connections (
    id TEXT PRIMARY KEY, document_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS mcp_credentials (
    connection_id TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
    nonce_hash TEXT PRIMARY KEY, start_hash TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL, user_id TEXT NOT NULL,
    authorization_url TEXT NOT NULL, binding_hash TEXT, expires_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);`);
}
