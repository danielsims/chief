import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersDeleteRemove(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(channelMembers)
        .where(eq(channelMembers.conversation_id, conversationId)),
    ),
  );
}
