import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { socketTickets } from "../../db/schema/socket-tickets";

export function socketTicketsDeleteConsumeSocketTicket<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, ticketHash: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .delete(socketTickets)
        .where(eq(socketTickets.ticket_hash, ticketHash))
        .returning({
          principal_json: socketTickets.principal_json,
          expires_at: socketTickets.expires_at,
        }),
    ),
  );
}
