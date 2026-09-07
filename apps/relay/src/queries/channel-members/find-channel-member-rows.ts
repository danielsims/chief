import { asc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersFindChannelMemberRows<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, conversationId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.conversation_id, conversationId))
        .orderBy(
          asc(channelMembers.joined_at),
          asc(channelMembers.principal_id),
        ),
    ),
  );
}
