import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function messagesInsertAppend(
  storage: DurableObjectStorage,
  {
    messageId,
    commandId,
    sequence,
    workspaceId,
    conversationId,
    threadRootId,
    authorKind,
    authorId,
    body,
    mentionsJson,
    componentsJson,
    createdAt,
  }: {
    messageId: string;
    commandId: string;
    sequence: number;
    workspaceId: string;
    conversationId: string;
    threadRootId: string | null;
    authorKind: string;
    authorId: string;
    body: string;
    mentionsJson: string;
    componentsJson: string;
    createdAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(messages).values({
        message_id: messageId,
        command_id: commandId,
        sequence: sequence,
        workspace_id: workspaceId,
        conversation_id: conversationId,
        thread_root_id: threadRootId,
        author_kind: authorKind,
        author_id: authorId,
        body: body,
        mentions_json: mentionsJson,
        components_json: componentsJson,
        created_at: createdAt,
      }),
    ),
  );
}
