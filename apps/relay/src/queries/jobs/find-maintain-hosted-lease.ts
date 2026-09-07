import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsFindMaintainHostedLease<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, jobId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          job_json: jobs.job_json,
          status: jobs.status,
          lease_token: jobs.lease_token,
          lease_expires_at: jobs.lease_expires_at,
        })
        .from(jobs)
        .where(eq(jobs.job_id, jobId)),
    ),
  );
}
