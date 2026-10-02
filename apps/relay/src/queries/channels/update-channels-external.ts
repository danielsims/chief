import { eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

/** A token makes the channel external; null makes it internal. */
export function channelsUpdateChannelsExternal(
  storage: DurableObjectStorage,
  {
    externalLinkToken,
    updatedAt,
    conversationId,
  }: {
    externalLinkToken: string | null;
    updatedAt: string;
    conversationId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(channels)
        .set({
          external_link_token: externalLinkToken,
          version: sql`${channels.version} + ${1}`,
          updated_at: updatedAt,
        })
        .where(eq(channels.conversation_id, conversationId)),
    ),
  );
}
