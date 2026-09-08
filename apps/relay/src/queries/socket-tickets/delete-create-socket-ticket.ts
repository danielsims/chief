import { lt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { socketTickets } from "../../db/schema/socket-tickets";

export function socketTicketsDeleteCreateSocketTicket(
  storage: DurableObjectStorage,
  expiresAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.delete(socketTickets).where(lt(socketTickets.expires_at, expiresAt)),
    ),
  );
}
