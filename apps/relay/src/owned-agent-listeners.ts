/**
 * Wake sockets an owned agent's host holds open so Chief can tell it a
 * message is waiting. They live in the workspace object beside members' live
 * sockets but are tagged apart: a listener receives only its own agent's
 * wake signal, never message text and never the workspace feed.
 */
export const OWNED_AGENT_LISTENER_TAG = "owned-agent-listener";
export const OWNED_AGENT_REVOKED_CLOSE_CODE = 4_403;

export function ownedAgentListenerTags(agentId: string) {
  return [OWNED_AGENT_LISTENER_TAG, `owned-agent:${agentId}`];
}

export function isOwnedAgentListener(
  ctx: DurableObjectState,
  socket: WebSocket,
) {
  return ctx.getTags(socket).includes(OWNED_AGENT_LISTENER_TAG);
}

type ListenerLookup = (agentId: string) => WebSocket[];

const lookups = new WeakMap<DurableObjectStorage, ListenerLookup>();

/** Called once by the workspace object, which owns the sockets. */
export function registerOwnedAgentListeners(ctx: DurableObjectState) {
  lookups.set(ctx.storage, (agentId) =>
    ctx.getWebSockets(`owned-agent:${agentId}`),
  );
}

export function ownedAgentListenerCount(
  storage: DurableObjectStorage,
  agentId: string,
) {
  return lookups.get(storage)?.(agentId).length ?? 0;
}

/** Tells every listener an agent has open that a message is waiting. */
export function wakeOwnedAgentListeners(
  storage: DurableObjectStorage,
  agentId: string,
  cursor: number,
) {
  const payload = JSON.stringify({ type: "wake", cursor });
  for (const socket of lookups.get(storage)?.(agentId) ?? []) {
    try {
      socket.send(payload);
    } catch {
      socket.close(1011, "Delivery failed");
    }
  }
}

/** Revocation and loss of access end an agent's live sockets at once. */
export function closeOwnedAgentListeners(
  storage: DurableObjectStorage,
  agentId: string,
) {
  for (const socket of lookups.get(storage)?.(agentId) ?? []) {
    try {
      socket.close(OWNED_AGENT_REVOKED_CLOSE_CODE, "Agent access revoked");
    } catch {
      // The socket is already gone.
    }
  }
}
