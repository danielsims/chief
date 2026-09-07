import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersDeleteRemoveRow(
  storage: DurableObjectStorage,
  principalId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(channelMembers)
        .where(
          and(
            eq(channelMembers.principal_kind, "agent"),
            eq(channelMembers.principal_id, principalId),
          ),
        ),
    ),
  );
}
