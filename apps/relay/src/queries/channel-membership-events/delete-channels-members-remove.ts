import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembershipEvents } from "../../db/schema/channel-membership-events";

export function channelMembershipEventsDeleteChannelsMembersRemove(
  storage: DurableObjectStorage,
  {
    conversationId,
    principalKind,
    principalId,
  }: { conversationId: string; principalKind: string; principalId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(channelMembershipEvents)
        .where(
          and(
            and(
              eq(channelMembershipEvents.conversation_id, conversationId),
              eq(channelMembershipEvents.principal_kind, principalKind),
            ),
            eq(channelMembershipEvents.principal_id, principalId),
          ),
        ),
    ),
  );
}
