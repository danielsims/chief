import { asc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersFindChannelsMembershipsList<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          conversation_id: channelMembers.conversation_id,
          principal_kind: channelMembers.principal_kind,
          principal_id: channelMembers.principal_id,
          role: channelMembers.role,
          joined_at: channelMembers.joined_at,
        })
        .from(channelMembers)
        .orderBy(
          asc(channelMembers.conversation_id),
          asc(channelMembers.principal_kind),
          asc(channelMembers.principal_id),
        ),
    ),
  );
}
