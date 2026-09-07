import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceLiveEvents } from "../../db/schema/workspace-live-events";

export function workspaceLiveEventsInsertPublish(
  storage: DurableObjectStorage,
  {
    sequence,
    conversationId,
    eventJson,
  }: { sequence: number; conversationId: string; eventJson: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceLiveEvents).values({
        sequence: sequence,
        conversation_id: conversationId,
        event_json: eventJson,
      }),
    ),
  );
}
