import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsFindComplete<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, leaseToken: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ job_id: jobs.job_id, job_json: jobs.job_json })
        .from(jobs)
        .where(
          and(eq(jobs.lease_token, leaseToken), eq(jobs.status, "leased")),
        ),
    ),
  );
}
