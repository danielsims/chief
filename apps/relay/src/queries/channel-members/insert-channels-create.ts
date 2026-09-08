import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersInsertChannelsCreate(
  storage: DurableObjectStorage,
  {
    conversationId,
    principalKind,
    principalId,
    joinedAt,
  }: {
    conversationId: string;
    principalKind: string;
    principalId: string;
    joinedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(channelMembers).values({
        conversation_id: conversationId,
        principal_kind: principalKind,
        principal_id: principalId,
        role: "owner",
        joined_at: joinedAt,
      }),
    ),
  );
}
