import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsUpdateComplete(
  storage: DurableObjectStorage,
  {
    jobJson,
    status,
    availableAt,
    updatedAt,
    jobId,
    leaseToken,
  }: {
    jobJson: string;
    status: string;
    availableAt: string;
    updatedAt: string;
    jobId: string;
    leaseToken: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(jobs)
        .set({
          job_json: jobJson,
          status: status,
          available_at: availableAt,
          lease_token: null,
          lease_expires_at: null,
          updated_at: updatedAt,
        })
        .where(and(eq(jobs.job_id, jobId), eq(jobs.lease_token, leaseToken))),
    ),
  );
}
