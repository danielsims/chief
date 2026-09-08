import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembershipBatches } from "../../db/schema/channel-membership-batches";

export function channelMembershipBatchesDeleteRemove(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(channelMembershipBatches)
        .where(eq(channelMembershipBatches.conversation_id, conversationId)),
    ),
  );
}
