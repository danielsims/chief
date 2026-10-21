import type { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  claimMachinePairing,
  createMachinePairing,
  createMachineTicket,
  listMachines,
  revokeMachine,
} from "./workspace-machine-keys";
import {
  disconnectMachine,
  fetchThroughWebMachine,
  onlineMachineIds,
} from "./workspace-web-machine";

/**
 * The workspace operations that pair, list and use lending machines, each
 * with the span it's traced under, or undefined for any other operation.
 */
export function machineOperation(
  ctx: DurableObjectState,
  channels: () => WorkspaceChannelStore,
  operation: string | null,
  request: Request,
): { span: string; run: () => Promise<Response> } | undefined {
  switch (operation) {
    case "machine-pairing-create":
      return {
        span: "workspace.machine.pairing",
        run: () => createMachinePairing(ctx.storage, request),
      };
    case "machine-pairing-claim":
      return {
        span: "workspace.machine.claim",
        run: () => claimMachinePairing(ctx.storage, channels(), request),
      };
    case "machine-ticket":
      return {
        span: "workspace.machine.ticket",
        run: () => createMachineTicket(ctx.storage, channels(), request),
      };
    case "machine-list":
      return {
        span: "workspace.machine.list",
        run: () => listMachines(ctx.storage, request, onlineMachineIds(ctx)),
      };
    case "machine-revoke":
      return {
        span: "workspace.machine.revoke",
        run: () =>
          revokeMachine(ctx.storage, request, (machineId) =>
            disconnectMachine(ctx, machineId),
          ),
      };
    case "machine-web-fetch":
      return {
        span: "workspace.machine.web_fetch",
        run: () => fetchThroughWebMachine(ctx, channels(), request),
      };
    default:
      return undefined;
  }
}
