import type { MessageAuthor, Principal } from "@chief/relay-contracts";

export function authorFor(principal: Principal): MessageAuthor {
  if (principal.kind === "user") return { kind: "user", id: principal.userId };
  if (principal.kind === "agent") {
    return { kind: "agent", id: principal.agentId };
  }
  return { kind: "system", id: "chief-relay" };
}

export function reactorPubkey(principal: Principal): string | undefined {
  return principal.kind === "user" || principal.kind === "agent"
    ? principal.pubkey
    : undefined;
}
