import { asc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpConnections } from "../../db/schema/mcp-connections";

export function mcpConnectionsFindConnections(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select({ document_json: mcpConnections.document_json })
      .from(mcpConnections)
      .orderBy(asc(mcpConnections.id))
      .all(),
  );
}
