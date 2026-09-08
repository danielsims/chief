import { desc, eq, isNull, or, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsFindListAgentJobs<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  value: SqlStorageValue,
  value2: SqlStorageValue,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ job_json: jobs.job_json })
        .from(jobs)
        .where(
          or(
            isNull(sql`${value}`),
            eq(
              sql`json_extract(${jobs.job_json}, ${"$.payload.workflowId"})`,
              value2,
            ),
          ),
        )
        .orderBy(desc(jobs.updated_at), desc(sql`${jobs}.rowid`))
        .limit(200),
    ),
  );
}
