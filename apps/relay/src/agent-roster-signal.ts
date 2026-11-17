import { sendToPeople } from "./workspace-people-sockets";

/** Operations that change the agent roster or its join requests. */
const rosterOperations = new Set([
  "owned-agent-connect",
  "owned-agent-request-approve",
  "owned-agent-request-on-device",
  "owned-agent-request-deny",
  "owned-agent-update",
  "owned-agent-avatar-set",
  "owned-agent-revoke",
  "owned-agent-channel-add",
  "owned-agent-channel-remove",
  "owned-agent-leave",
  // A removed member's agents leave with them.
  "members-remove",
]);

const changed = JSON.stringify({ type: "workspace.agents.changed" });

/**
 * Tells members' open apps the roster changed, so none of them polls for it.
 * The signal is empty; each app re-reads through its own authorized request.
 */
export function signalAgentRoster(
  ctx: DurableObjectState,
  operation: string | null,
  response: Response,
) {
  if (response.ok && rosterOperations.has(operation ?? ""))
    sendToPeople(ctx, changed);
}
