import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsUpdateClaim(
  storage: DurableObjectStorage,
  {
    jobJson,
    leaseToken,
    leaseExpiresAt,
    updatedAt,
    jobId,
  }: {
    jobJson: string;
    leaseToken: string | null;
    leaseExpiresAt: string | null;
    updatedAt: string;
    jobId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(jobs)
        .set({
          job_json: jobJson,
          status: "leased",
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          updated_at: updatedAt,
        })
        .where(eq(jobs.job_id, jobId)),
    ),
  );
}
