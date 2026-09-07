import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsUpdateInitializeWorkspaceSchema(
  storage: DurableObjectStorage,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(channels)
        .set({ is_private: 0 })
        .where(eq(channels.conversation_id, "mission-control")),
    ),
  );
}
