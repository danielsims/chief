import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsFindRefreshExisting<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, jobId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.job_id, jobId)),
    ),
  );
}
