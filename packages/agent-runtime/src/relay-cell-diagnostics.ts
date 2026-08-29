import type { JsonValue } from "@chief/relay-contracts";

export function cellToolDiagnostic(
  phase: "catalog" | "started" | "completed" | "failed",
  details: Record<string, JsonValue>,
): void {
  const record = {
    scope: "cell.tools",
    phase,
    relayId: process.env.CHIEF_RELAY_URL,
    workspaceId: process.env.CHIEF_WORKSPACE_ID,
    conversationId: process.env.CHIEF_CONVERSATION_ID,
    agentId: process.env.CHIEF_AGENT_ID,
    ...details,
  };
  const serialized = JSON.stringify(record);
  if (phase === "failed") console.error("[cell-tool]", serialized);
  else console.info("[cell-tool]", serialized);
}
