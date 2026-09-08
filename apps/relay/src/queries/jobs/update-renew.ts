import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsUpdateRenew(
  storage: DurableObjectStorage,
  {
    leaseExpiresAt,
    jobId,
    leaseToken,
  }: { leaseExpiresAt: string | null; jobId: string; leaseToken: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(jobs)
        .set({ lease_expires_at: leaseExpiresAt })
        .where(and(eq(jobs.job_id, jobId), eq(jobs.lease_token, leaseToken))),
    ),
  );
}
