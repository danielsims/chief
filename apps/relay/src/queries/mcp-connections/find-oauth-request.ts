import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpOAuthRequests } from "../../db/schema/mcp-connections";

export function mcpConnectionsFindOAuthRequest(
  storage: DurableObjectStorage,
  by: { nonceHash: string } | { startHash: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(mcpOAuthRequests)
      .where(
        "nonceHash" in by
          ? eq(mcpOAuthRequests.nonce_hash, by.nonceHash)
          : eq(mcpOAuthRequests.start_hash, by.startHash),
      )
      .get(),
  );
}
