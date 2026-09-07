import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersFindValidateOnboardingDelegation<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ principal_id: channelMembers.principal_id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.conversation_id, "mission-control"),
            eq(channelMembers.principal_kind, "agent"),
          ),
        ),
    ),
  );
}
