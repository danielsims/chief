import { sendToPeople } from "./workspace-people-sockets";

const changed = JSON.stringify({ type: "workspace.machines.changed" });

/** Operations that add or remove a paired computer. */
const machineListOperations = new Set([
  "machine-pairing-claim",
  "machine-revoke",
]);

/**
 * Tells members' open apps their paired computers changed, so the Machines
 * page never polls for who's online. The signal is empty; each app re-reads
 * through its own authorized request.
 */
export function signalMachineList(ctx: DurableObjectState) {
  sendToPeople(ctx, changed);
}

export function signalMachineListAfter(
  ctx: DurableObjectState,
  operation: string | null,
  response: Response,
) {
  if (response.ok && machineListOperations.has(operation ?? ""))
    signalMachineList(ctx);
}
