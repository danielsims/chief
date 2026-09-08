import { and, asc, eq, lte, or, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsFindClaim<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, availableAt: string, leaseExpiresAt: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ job_id: jobs.job_id, job_json: jobs.job_json })
        .from(jobs)
        .where(
          or(
            and(
              eq(jobs.status, "pending"),
              lte(jobs.available_at, availableAt),
            ),
            and(
              eq(jobs.status, "leased"),
              lte(jobs.lease_expires_at, leaseExpiresAt),
            ),
          ),
        )
        .orderBy(asc(jobs.available_at), asc(sql`${jobs}.rowid`))
        .limit(1),
    ),
  );
}
