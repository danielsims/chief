import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { socketTickets } from "../../db/schema/socket-tickets";

export function socketTicketsInsertCreateSocketTicket(
  storage: DurableObjectStorage,
  {
    ticketHash,
    principalJson,
    expiresAt,
  }: { ticketHash: string; principalJson: string; expiresAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(socketTickets).values({
        ticket_hash: ticketHash,
        principal_json: principalJson,
        expires_at: expiresAt,
      }),
    ),
  );
}
