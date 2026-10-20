import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpCredentials } from "../../db/schema/mcp-connections";

export function mcpConnectionsFindCredential(
  storage: DurableObjectStorage,
  connectionId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select({ sealed: mcpCredentials.sealed })
      .from(mcpCredentials)
      .where(eq(mcpCredentials.connection_id, connectionId))
      .get(),
  );
}
