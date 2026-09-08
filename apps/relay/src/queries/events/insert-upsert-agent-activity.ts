import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { events } from "../../db/schema/events";

export function eventsInsertUpsertAgentActivity(
  storage: DurableObjectStorage,
  {
    sequence,
    eventId,
    eventJson,
  }: { sequence: number; eventId: string; eventJson: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(events).values({
        sequence: sequence,
        event_id: eventId,
        event_json: eventJson,
      }),
    ),
  );
}
