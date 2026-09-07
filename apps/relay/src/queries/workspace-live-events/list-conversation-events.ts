import { and, asc, gt, inArray } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceLiveEvents } from "../../db/schema/workspace-live-events";

export function listConversationEvents<
  Row extends Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  {
    after,
    conversationIds,
    limit,
  }: { after: number; conversationIds: readonly string[]; limit: number },
) {
  if (conversationIds.length === 0) return [];
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceLiveEvents)
        .where(
          and(
            gt(workspaceLiveEvents.sequence, after),
            inArray(workspaceLiveEvents.conversation_id, [...conversationIds]),
          ),
        )
        .orderBy(asc(workspaceLiveEvents.sequence))
        .limit(limit),
    ),
  );
}
