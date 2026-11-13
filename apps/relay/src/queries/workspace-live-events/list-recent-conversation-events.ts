import { desc, inArray } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceLiveEvents } from "../../db/schema/workspace-live-events";

/** The newest events of the given conversations, newest first. */
export function listRecentConversationEvents<
  Row extends Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  {
    conversationIds,
    limit,
  }: { conversationIds: readonly string[]; limit: number },
) {
  if (conversationIds.length === 0) return [];
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceLiveEvents)
        .where(
          inArray(workspaceLiveEvents.conversation_id, [...conversationIds]),
        )
        .orderBy(desc(workspaceLiveEvents.sequence))
        .limit(limit),
    ),
  );
}
