import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpConnections } from "../../db/schema/mcp-connections";

export function mcpConnectionsFindConnection(
  storage: DurableObjectStorage,
  id: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select({ document_json: mcpConnections.document_json })
      .from(mcpConnections)
      .where(eq(mcpConnections.id, id))
      .get(),
  );
}
