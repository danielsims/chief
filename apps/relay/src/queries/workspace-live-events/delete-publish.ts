import { lte } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceLiveEvents } from "../../db/schema/workspace-live-events";

export function workspaceLiveEventsDeletePublish(
  storage: DurableObjectStorage,
  sequence: number,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(workspaceLiveEvents)
        .where(lte(workspaceLiveEvents.sequence, sequence)),
    ),
  );
}
