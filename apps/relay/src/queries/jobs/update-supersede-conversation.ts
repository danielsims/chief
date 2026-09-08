import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsUpdateSupersedeConversation(
  storage: DurableObjectStorage,
  {
    jobJson,
    updatedAt,
    jobId,
  }: { jobJson: string; updatedAt: string; jobId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(jobs)
        .set({
          job_json: jobJson,
          status: "completed",
          lease_token: null,
          lease_expires_at: null,
          updated_at: updatedAt,
        })
        .where(eq(jobs.job_id, jobId)),
    ),
  );
}
