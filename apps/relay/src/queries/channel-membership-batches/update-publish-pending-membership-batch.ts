import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembershipBatches } from "../../db/schema/channel-membership-batches";

export function channelMembershipBatchesUpdatePublishPendingMembershipBatch(
  storage: DurableObjectStorage,
  commandId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(channelMembershipBatches)
        .set({ published: 1 })
        .where(eq(channelMembershipBatches.command_id, commandId)),
    ),
  );
}
