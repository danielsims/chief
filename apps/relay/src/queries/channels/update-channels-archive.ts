import { eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsUpdateChannelsArchive(
  storage: DurableObjectStorage,
  {
    archived,
    updatedAt,
    conversationId,
  }: { archived: number; updatedAt: string; conversationId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(channels)
        .set({
          archived: archived,
          version: sql`${channels.version} + ${1}`,
          updated_at: updatedAt,
        })
        .where(eq(channels.conversation_id, conversationId)),
    ),
  );
}
