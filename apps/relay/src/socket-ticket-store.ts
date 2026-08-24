import type { Principal } from "@chief/relay-contracts";

interface SocketTicketRow extends Record<string, SqlStorageValue> {
  principal_json: string;
  expires_at: string;
}

export function initializeSocketTickets(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS socket_tickets (
      ticket_hash TEXT PRIMARY KEY,
      principal_json TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS socket_tickets_expiry_idx
      ON socket_tickets (expires_at);
  `);
}

export async function createSocketTicket(
  storage: DurableObjectStorage,
  principal: Principal,
) {
  const ticket = randomTicket();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  storage.sql.exec(
    `INSERT INTO socket_tickets (ticket_hash, principal_json, expires_at)
     VALUES (?, ?, ?)`,
    await hashTicket(ticket),
    JSON.stringify(principal),
    expiresAt,
  );
  storage.sql.exec(
    "DELETE FROM socket_tickets WHERE expires_at < ?",
    new Date().toISOString(),
  );
  return { ticket, expiresAt };
}

export async function consumeSocketTicket(
  storage: DurableObjectStorage,
  ticket: string,
) {
  const ticketHash = await hashTicket(ticket);
  return storage.transactionSync(() => {
    const row = firstRow<SocketTicketRow>(
      storage.sql.exec(
        `DELETE FROM socket_tickets WHERE ticket_hash = ?
         RETURNING principal_json, expires_at`,
        ticketHash,
      ),
    );
    if (!row || row.expires_at < new Date().toISOString()) return null;
    return row.principal_json;
  });
}

function randomTicket() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function hashTicket(ticket: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
