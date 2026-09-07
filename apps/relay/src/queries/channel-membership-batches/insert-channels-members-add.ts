import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembershipBatches } from "../../db/schema/channel-membership-batches";

export function channelMembershipBatchesInsertChannelsMembersAdd(
  storage: DurableObjectStorage,
  {
    commandId,
    conversationId,
    eventJson,
    published,
  }: {
    commandId: string;
    conversationId: string;
    eventJson: string;
    published: number;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(channelMembershipBatches).values({
        command_id: commandId,
        conversation_id: conversationId,
        event_json: eventJson,
        published: published,
      }),
    ),
  );
}
