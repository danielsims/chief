import { eq, lt, or } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpOAuthRequests } from "../../db/schema/mcp-connections";

/** One sign-in per connection: starting again replaces the earlier request. */
export function mcpConnectionsInsertOAuthRequest(
  storage: DurableObjectStorage,
  row: typeof mcpOAuthRequests.$inferInsert,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() => {
    db.run(
      db
        .delete(mcpOAuthRequests)
        .where(
          or(
            eq(mcpOAuthRequests.connection_id, row.connection_id),
            lt(mcpOAuthRequests.expires_at, Date.now()),
          ),
        ),
    );
    db.run(db.insert(mcpOAuthRequests).values(row));
  });
}
