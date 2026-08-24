import type {
  agentJobSchema,
  AgentPrincipal,
  JsonValue,
} from "@chief/relay-contracts";
import { parseJsonValue } from "@chief/relay-contracts";

export function hostedPrincipal(
  job: ReturnType<typeof agentJobSchema.parse>,
): AgentPrincipal {
  return {
    kind: "agent",
    agentId: job.agentId,
    pubkey: job.agentPubkey?.toLowerCase() ?? "0".repeat(64),
    workspaceId: job.workspaceId,
    role: "member",
  };
}

export function parseStoredJson(value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return parseJsonValue(parsed) ?? null;
  } catch {
    return null;
  }
}

export function safeJsonArray(value: string): JsonValue[] {
  const parsed = parseStoredJson(value);
  return Array.isArray(parsed) ? parsed : [];
}
