import type { SessionManager } from "./manager.js";
import type { RecurringWorkRecord } from "./types.js";

export async function pauseScheduledWorkForMissingChannel(input: {
  manager: SessionManager;
  onChange: (workspaceId: string) => void | Promise<void>;
  message: string;
  work: RecurringWorkRecord;
  workspaceId: string;
}) {
  const failedAt = Date.now();
  await input.manager.saveRecurringWork(input.workspaceId, {
    ...input.work,
    status: "error",
    nextAt: undefined,
    lastSummary: input.message,
    updatedAt: failedAt,
  });
  await input.onChange(input.workspaceId);
}
