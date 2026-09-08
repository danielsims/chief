import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsDeleteRemove(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.delete(channels).where(eq(channels.conversation_id, conversationId)),
    ),
  );
}
