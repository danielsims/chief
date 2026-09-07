import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceFiles } from "../../db/schema/workspace-files";

export function workspaceFilesInsertSaveBrandProfile(
  storage: DurableObjectStorage,
  {
    content,
    conversationId,
    authorAgentId,
    version,
    createdAt,
    updatedAt,
  }: {
    content: string;
    conversationId: string;
    authorAgentId: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(workspaceFiles)
        .values({
          file_id: "brand-profile",
          path: "brand/profile.md",
          title: "Brand profile",
          mime_type: "text/markdown",
          content: content,
          conversation_id: conversationId,
          author_agent_id: authorAgentId,
          version: version,
          created_at: createdAt,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [workspaceFiles.file_id],
          set: {
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
