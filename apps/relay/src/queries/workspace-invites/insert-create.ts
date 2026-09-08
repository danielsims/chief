import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInvites } from "../../db/schema/workspace-invites";

export function workspaceInvitesInsertCreate(
  storage: DurableObjectStorage,
  {
    inviteId,
    secretHash,
    conversationId,
    createdByUserId,
    expiresAt,
    createdAt,
  }: {
    inviteId: string;
    secretHash: string;
    conversationId: string | null;
    createdByUserId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceInvites).values({
        invite_id: inviteId,
        secret_hash: secretHash,
        conversation_id: conversationId,
        created_by_user_id: createdByUserId,
        expires_at: expiresAt,
        use_count: 0,
        revoked_at: null,
        created_at: createdAt,
      }),
    ),
  );
}
