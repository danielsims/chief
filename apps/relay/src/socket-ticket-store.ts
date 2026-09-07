import type { Principal } from "@chief/relay-contracts";

import { initializeSocketTickets as initializeSocketTicketTables } from "./db/migrations/initialize-socket-tickets";
import { socketTicketsDeleteConsumeSocketTicket } from "./queries/socket-tickets/delete-consume-socket-ticket";
import { socketTicketsDeleteCreateSocketTicket } from "./queries/socket-tickets/delete-create-socket-ticket";
import { socketTicketsInsertCreateSocketTicket } from "./queries/socket-tickets/insert-create-socket-ticket";

interface SocketTicketRow extends Record<string, SqlStorageValue> {
  principal_json: string;
  expires_at: string;
}

export function initializeSocketTickets(storage: DurableObjectStorage) {
  initializeSocketTicketTables(storage);
}

export async function createSocketTicket(
  storage: DurableObjectStorage,
  principal: Principal,
) {
  const ticket = randomTicket();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  socketTicketsInsertCreateSocketTicket(storage, {
    ticketHash: await hashTicket(ticket),
    principalJson: JSON.stringify(principal),
    expiresAt: expiresAt,
  });
  socketTicketsDeleteCreateSocketTicket(storage, new Date().toISOString());
  return { ticket, expiresAt };
}

export async function consumeSocketTicket(
  storage: DurableObjectStorage,
  ticket: string,
) {
  const ticketHash = await hashTicket(ticket);
  return storage.transactionSync(() => {
    const row = firstRow<SocketTicketRow>(
      socketTicketsDeleteConsumeSocketTicket(storage, ticketHash),
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
