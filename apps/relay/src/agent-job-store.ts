import type { AgentPrincipal, Principal } from "@chief/relay-contracts";

import { initializeAgentTables } from "./db/migrations/initialize-agent-tables";
import { HttpError } from "./http";

export function initializeAgentJobs(storage: DurableObjectStorage) {
  initializeAgentTables(storage);
}

export function firstAgentRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}

export function actorPubkey(principal: Principal): string | undefined {
  return principal.kind === "agent" || principal.kind === "user"
    ? principal.pubkey
    : undefined;
}

export function requireAgentPrincipal(
  principal: Principal,
): asserts principal is AgentPrincipal {
  if (principal.kind !== "agent") {
    throw new HttpError(
      403,
      "agent_required",
      "An agent identity is required for mailbox work.",
    );
  }
}

export function requireAgentOwnsJob(
  principal: AgentPrincipal,
  agentId: string,
) {
  if (principal.agentId !== agentId) {
    throw new HttpError(
      403,
      "agent_job_access_denied",
      "An agent can only work jobs from its own mailbox.",
    );
  }
}
