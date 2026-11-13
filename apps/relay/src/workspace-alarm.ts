import { drainExternalAgentOutbox } from "./workspace-external-agent-alarm";
import { drainWorkspaceSchedules } from "./workspace-schedule-dispatch";
import { wakeWorkspaceSchedules } from "./workspace-schedule-store";

const ALARM_RECOVERY_MS = 60_000;

export async function runWorkspaceAlarm(
  storage: DurableObjectStorage,
  env: Env,
) {
  // Persist another wake-up before network work. A terminated isolate cannot run finally.
  await storage.setAlarm(Date.now() + ALARM_RECOVERY_MS);
  try {
    try {
      await drainExternalAgentOutbox(storage, env);
    } finally {
      // A delivery failure must not prevent due occurrences from entering run history.
      await drainWorkspaceSchedules(storage, env);
    }
    await wakeWorkspaceSchedules(storage);
  } catch (error) {
    // Cloudflare's automatic retries are bounded; retain a wake-up after they expire.
    await storage.setAlarm(Date.now() + ALARM_RECOVERY_MS);
    throw error;
  }
}
