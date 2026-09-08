import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { brandProfile } from "../../db/schema/brand-profile";

export function brandProfileInsertSaveBrandProfile(
  storage: DurableObjectStorage,
  {
    markdown,
    sourceUrlsJson,
    version,
    authorAgentId,
    updatedAt,
  }: {
    markdown: string;
    sourceUrlsJson: string;
    version: number;
    authorAgentId: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(brandProfile)
        .values({
          singleton: 1,
          markdown: markdown,
          source_urls_json: sourceUrlsJson,
          version: version,
          author_agent_id: authorAgentId,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [brandProfile.singleton],
          set: {
            markdown: sql`excluded.markdown`,
            source_urls_json: sql`excluded.source_urls_json`,
            version: sql`excluded.version`,
            author_agent_id: sql`excluded.author_agent_id`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
