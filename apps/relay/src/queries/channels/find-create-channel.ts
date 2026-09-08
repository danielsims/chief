import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsFindCreateChannel<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, conversationId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ conversation_id: channels.conversation_id })
        .from(channels)
        .where(eq(channels.conversation_id, conversationId)),
    ),
  );
}
