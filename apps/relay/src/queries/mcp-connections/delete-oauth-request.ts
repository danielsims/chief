import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpOAuthRequests } from "../../db/schema/mcp-connections";

export function mcpConnectionsDeleteOAuthRequest(
  storage: DurableObjectStorage,
  nonceHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(mcpOAuthRequests)
      .where(eq(mcpOAuthRequests.nonce_hash, nonceHash))
      .returning({ nonce_hash: mcpOAuthRequests.nonce_hash })
      .all(),
  );
}
