import { and, eq, inArray, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsFindCancelAgentWorkflow<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, value: SqlStorageValue) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ job_json: jobs.job_json })
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, ["pending", "leased"]),
            eq(
              sql`json_extract(${jobs.job_json}, ${"$.payload.workflowId"})`,
              value,
            ),
          ),
        ),
    ),
  );
}
