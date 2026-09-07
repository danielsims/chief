import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembershipEvents } from "../../db/schema/channel-membership-events";

export function channelMembershipEventsDeleteRemove(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(channelMembershipEvents)
        .where(eq(channelMembershipEvents.conversation_id, conversationId)),
    ),
  );
}
