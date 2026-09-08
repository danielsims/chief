import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersFindChannelsMembersRemove<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  {
    conversationId,
    principalKind,
    principalId,
  }: { conversationId: string; principalKind: string; principalId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(channelMembers)
        .where(
          and(
            and(
              eq(channelMembers.conversation_id, conversationId),
              eq(channelMembers.principal_kind, principalKind),
            ),
            eq(channelMembers.principal_id, principalId),
          ),
        ),
    ),
  );
}
