import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function channelMembersInsertDirectMembers(
  storage: DurableObjectStorage,
  {
    conversationId,
    ownerKind,
    ownerId,
    ownerJoinedAt,
    memberConversationId,
    memberKind,
    memberId,
    memberJoinedAt,
  }: {
    conversationId: string;
    ownerKind: string;
    ownerId: string;
    ownerJoinedAt: string;
    memberConversationId: string;
    memberKind: string;
    memberId: string;
    memberJoinedAt: string;
  },
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).run(sql`
INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES (${conversationId}, ${ownerKind}, ${ownerId}, 'owner', ${ownerJoinedAt}), (${memberConversationId}, ${memberKind}, ${memberId}, 'member', ${memberJoinedAt})
`),
  );
}
