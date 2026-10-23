import { and, eq, isNull } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpOAuthRequests } from "../../db/schema/mcp-connections";

/** Binds a request to one browser. Succeeds only once per request. */
export function mcpConnectionsUpdateOAuthBinding(
  storage: DurableObjectStorage,
  nonceHash: string,
  bindingHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .update(mcpOAuthRequests)
      .set({ binding_hash: bindingHash })
      .where(
        and(
          eq(mcpOAuthRequests.nonce_hash, nonceHash),
          isNull(mcpOAuthRequests.binding_hash),
        ),
      )
      .returning({ nonce_hash: mcpOAuthRequests.nonce_hash })
      .all(),
  );
}
