import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { secrets } from "../../db/schema/secrets";

export function upsertSecretRecord(
  storage: DurableObjectStorage,
  {
    key,
    valueJson,
    updatedAt,
  }: { key: string; valueJson: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(secrets)
        .values({ key: key, value_json: valueJson, updated_at: updatedAt })
        .onConflictDoUpdate({
          target: [secrets.key],
          set: {
            value_json: sql`excluded.value_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
