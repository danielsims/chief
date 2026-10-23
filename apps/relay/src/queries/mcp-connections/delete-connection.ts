import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import {
  mcpConnections,
  mcpCredentials,
  mcpOAuthRequests,
} from "../../db/schema/mcp-connections";

/** Removes the connection, its sealed credentials and any sign-in in flight. */
export function mcpConnectionsDeleteConnection(
  storage: DurableObjectStorage,
  id: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() => {
    db.run(
      db.delete(mcpOAuthRequests).where(eq(mcpOAuthRequests.connection_id, id)),
    );
    db.run(
      db.delete(mcpCredentials).where(eq(mcpCredentials.connection_id, id)),
    );
    db.run(db.delete(mcpConnections).where(eq(mcpConnections.id, id)));
  });
}
