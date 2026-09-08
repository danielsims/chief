import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceFiles } from "../../db/schema/workspace-files";

export function workspaceFilesInsertSaveFile(
  storage: DurableObjectStorage,
  {
    fileId,
    path,
    title,
    mimeType,
    content,
    conversationId,
    authorAgentId,
    version,
    createdAt,
    updatedAt,
    assetJson,
  }: {
    fileId: string;
    path: string;
    title: string;
    mimeType: string;
    content: string;
    conversationId: string;
    authorAgentId: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    assetJson: string | null;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(workspaceFiles)
        .values({
          file_id: fileId,
          path: path,
          title: title,
          mime_type: mimeType,
          content: content,
          conversation_id: conversationId,
          author_agent_id: authorAgentId,
          version: version,
          created_at: createdAt,
          updated_at: updatedAt,
          asset_json: assetJson,
        })
        .onConflictDoUpdate({
          target: [workspaceFiles.file_id],
          set: {
            path: sql`excluded.path`,
            title: sql`excluded.title`,
            mime_type: sql`excluded.mime_type`,
            content: sql`excluded.content`,
            conversation_id: sql`excluded.conversation_id`,
            author_agent_id: sql`excluded.author_agent_id`,
            version: sql`excluded.version`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
