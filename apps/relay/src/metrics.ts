import type { UserPrincipal } from "@chief/relay-contracts";
import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { withTrustedIdentity } from "./internal-context";

/**
 * Fire-and-forget product metrics. Recording never blocks or fails the request
 * path: it schedules a fetch to the Analytics DO in the background. Dimensions
 * are meant to be enumerated strings (signup, active-user, workspace-message,
 * agent-created) that a product-owner dashboard can aggregate.
 */
export function recordMetrics(
  env: Env,
  dimensions: string[],
  author?: UserPrincipal,
): void {
  if (!dimensions.length) return;
  void Promise.resolve().then(async () => {
    try {
      const stub = env.METRICS.get(env.METRICS.idFromName("global"));
      await stub.fetch(
        withTrustedIdentity(
          {
            identity: {
              kind: "user",
              userId: userIdSchema.parse(
                (author?.userId ?? "system").slice(0, 128),
              ),
              pubkey: author?.pubkey ?? "0".repeat(64),
            },
            requestId: crypto.randomUUID(),
            workspaceId: workspaceIdSchema.parse(
              author?.workspaceId ?? "workspace-system",
            ),
          },
          {
            method: "POST",
            headers: { "x-chief-internal-operation": "record" },
            body: JSON.stringify({ dimensions }),
          },
        ),
      );
    } catch {
      // Observability only — never fail the caller.
    }
  });
}
