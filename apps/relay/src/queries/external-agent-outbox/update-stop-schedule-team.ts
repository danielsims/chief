import { and, eq, inArray } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function externalAgentOutboxUpdateStopScheduleTeam(
  storage: DurableObjectStorage,
  threadRootId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentOutbox)
        .set({ status: "dropped", delivering_since: null })
        .where(
          and(
            eq(externalAgentOutbox.thread_root_id, threadRootId),
            inArray(externalAgentOutbox.status, [
              "queued",
              "delivering",
              "reconciling",
            ]),
          ),
        ),
    ),
  );
}
