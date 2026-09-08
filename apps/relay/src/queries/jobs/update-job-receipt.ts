import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function updateJobReceipt(
  storage: DurableObjectStorage,
  input: {
    jobId: string;
    jobJson: string;
    availableAt: string;
    updatedAt: string;
    reset: boolean;
  },
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage)
      .update(jobs)
      .set({
        job_json: input.jobJson,
        available_at: input.availableAt,
        updated_at: input.updatedAt,
        status: input.reset ? "pending" : undefined,
        lease_token: input.reset ? null : undefined,
        lease_expires_at: input.reset ? null : undefined,
      })
      .where(eq(jobs.job_id, input.jobId))
      .run(),
  );
}
