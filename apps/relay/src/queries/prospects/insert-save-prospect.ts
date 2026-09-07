import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { prospects } from "../../db/schema/prospects";

export function prospectsInsertSaveProspect(
  storage: DurableObjectStorage,
  {
    prospectId,
    prospectJson,
    relevance,
    foundAt,
    updatedAt,
  }: {
    prospectId: string;
    prospectJson: string;
    relevance: string;
    foundAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(prospects)
        .values({
          prospect_id: prospectId,
          prospect_json: prospectJson,
          relevance: relevance,
          found_at: foundAt,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [prospects.prospect_id],
          set: {
            prospect_json: sql`excluded.prospect_json`,
            relevance: sql`excluded.relevance`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
