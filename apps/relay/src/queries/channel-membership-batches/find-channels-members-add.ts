import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembershipBatches } from "../../db/schema/channel-membership-batches";

export function channelMembershipBatchesFindChannelsMembersAdd<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, commandId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(channelMembershipBatches)
        .where(eq(channelMembershipBatches.command_id, commandId)),
    ),
  );
}
