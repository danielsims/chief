import type { PeopleSocketContext } from "./workspace-people-sockets";
import { sendToPeople } from "./workspace-people-sockets";

const changed = JSON.stringify({ type: "workspace.machines.changed" });
const activityChanged = JSON.stringify({
  type: "workspace.machines.activity",
});

/** Operations that add or remove a paired computer. */
const machineListOperations = new Set([
  "machine-pairing-claim",
  "machine-revoke",
  "machine-set-enabled",
]);

/**
 * Tells members' open apps their paired computers changed, so the Machines
 * page never polls for who's online. The signal is empty; each app re-reads
 * through its own authorized request.
 */
export function signalMachineList(ctx: DurableObjectState) {
  sendToPeople(ctx, changed);
}

/** Tells members' apps that a machine served a page; they re-read activity. */
export function signalMachineActivity(ctx: PeopleSocketContext) {
  sendToPeople(ctx, activityChanged);
}

export function signalMachineListAfter(
  ctx: DurableObjectState,
  operation: string | null,
  response: Response,
) {
  if (response.ok && machineListOperations.has(operation ?? ""))
    signalMachineList(ctx);
}
