import type { MessageAuthor, Principal } from "@chief/relay-contracts";

export function authorFor(principal: Principal): MessageAuthor {
  if (principal.kind === "user") return { kind: "user", id: principal.userId };
  if (principal.kind === "agent") {
    return { kind: "agent", id: principal.agentId };
  }
  if (principal.kind === "guest") {
    return {
      kind: "guest",
      id: principal.guestId,
      name: principal.name,
      provider: principal.provider,
      ...(principal.model ? { model: principal.model } : undefined),
      ...(principal.image ? { image: principal.image } : undefined),
      ...(principal.mark ? { mark: principal.mark } : undefined),
      ...(principal.operator ? { operator: principal.operator } : undefined),
    };
  }
  return { kind: "system", id: "relay" };
}

export function reactorPubkey(principal: Principal): string | undefined {
  return principal.kind === "user" || principal.kind === "agent"
    ? principal.pubkey
    : undefined;
}
