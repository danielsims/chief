import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsInsertPrepareScheduleChannel(
  storage: DurableObjectStorage,
  {
    conversationId,
    workspaceId,
    name,
    description,
    createdByKind,
    createdById,
    createdAt,
    updatedAt,
  }: {
    conversationId: string;
    workspaceId: string;
    name: string;
    description: string | null;
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
        kind: "channel",
        is_private: 0,
        archived: 0,
        description: description,
        created_by_kind: createdByKind,
        created_by_id: createdById,
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ),
  );
}
