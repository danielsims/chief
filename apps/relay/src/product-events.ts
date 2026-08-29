import type { UserPrincipal } from "@chief/relay-contracts";

export type ProductEventName =
  | "active-workspace"
  | "agent-created"
  | "channel-created"
  | "message"
  | "signup"
  | "workspace-created";

interface ProductEventContext {
  relayId: string;
  deployment: string;
  workspaceId?: string;
  userId?: string;
}

/**
 * Emit product events to the deployment's log pipeline. Cloudflare captures
 * these with Workers Observability; self-hosted relays retain them in their
 * container log stream. Product telemetry is never stored in relay state.
 */
export function recordProductEvents(
  env: Pick<Env, "RELAY_ID" | "RELAY_DEPLOYMENT">,
  events: readonly ProductEventName[],
  author?: UserPrincipal,
): void {
  if (events.length === 0) return;
  const context: ProductEventContext = {
    relayId: env.RELAY_ID,
    deployment: env.RELAY_DEPLOYMENT,
    ...(author?.workspaceId ? { workspaceId: author.workspaceId } : undefined),
    ...(author?.userId ? { userId: author.userId } : undefined),
  };
  for (const event of events) {
    console.info(
      "[relay-product-event]",
      JSON.stringify({ scope: "relay.product", event, ...context }),
    );
  }
}
