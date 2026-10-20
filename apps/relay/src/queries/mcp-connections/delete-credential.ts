import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpCredentials } from "../../db/schema/mcp-connections";

export function mcpConnectionsDeleteCredential(
  storage: DurableObjectStorage,
  connectionId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(mcpCredentials)
        .where(eq(mcpCredentials.connection_id, connectionId)),
    ),
  );
}
