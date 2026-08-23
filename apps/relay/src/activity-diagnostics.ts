import type { AgentActivityComponent } from "@chief/relay-contracts";

interface ActivityDiagnostic {
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
  agentId: string;
  requestId: string;
  messageId: string;
  component: AgentActivityComponent;
}

export function recordRelayActivity(
  phase: "persisted" | "broadcast",
  diagnostic: ActivityDiagnostic,
  result: { created: boolean; event: Record<string, unknown> },
) {
  const { component, ...scope } = diagnostic;
  console.info(
    "[relay-activity]",
    JSON.stringify({
      scope: "relay.activity",
      phase,
      ...scope,
      componentId: component.id,
      toolCallId: component.kind === "tool" ? component.id : undefined,
      kind: component.kind,
      status: component.kind === "error" ? "failed" : component.payload.status,
      created: result.created,
      sequence: result.event.sequence,
      eventType: result.event.type,
    }),
  );
}
