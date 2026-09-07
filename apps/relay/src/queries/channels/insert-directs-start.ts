import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsInsertDirectsStart(
  storage: DurableObjectStorage,
  {
    conversationId,
    workspaceId,
    name,
    createdByKind,
    createdById,
    createdAt,
    updatedAt,
  }: {
    conversationId: string;
    workspaceId: string;
    name: string;
    createdByKind: string;
    createdById: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(channels).values({
        conversation_id: conversationId,
        workspace_id: workspaceId,
        name: name,
        kind: "direct",
        is_private: 1,
        archived: 0,
        description: null,
        created_by_kind: createdByKind,
        created_by_id: createdById,
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ),
  );
}
