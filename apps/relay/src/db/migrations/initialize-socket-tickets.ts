export function initializeSocketTickets<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    CREATE TABLE IF NOT EXISTS socket_tickets (
      ticket_hash TEXT PRIMARY KEY,
      principal_json TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS socket_tickets_expiry_idx
      ON socket_tickets (expires_at);
  `);
}
