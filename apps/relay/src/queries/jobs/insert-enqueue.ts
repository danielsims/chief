import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { jobs } from "../../db/schema/jobs";

export function jobsInsertEnqueue(
  storage: DurableObjectStorage,
  {
    jobId,
    jobJson,
    availableAt,
    updatedAt,
  }: { jobId: string; jobJson: string; availableAt: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(jobs).values({
        job_id: jobId,
        job_json: jobJson,
        status: "pending",
        available_at: availableAt,
        lease_token: null,
        lease_expires_at: null,
        updated_at: updatedAt,
      }),
    ),
  );
}
