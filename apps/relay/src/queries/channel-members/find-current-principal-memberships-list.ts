import { and, asc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersFindCurrentPrincipalMembershipsList<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, principalKind: string, principalId: string) {
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
        .where(
          and(
            eq(channelMembers.principal_kind, principalKind),
            eq(channelMembers.principal_id, principalId),
          ),
        )
        .orderBy(asc(channelMembers.conversation_id)),
    ),
  );
}
