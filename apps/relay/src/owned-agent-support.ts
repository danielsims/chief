import type { WorkspaceId } from "@chief/relay-contracts";
import { getUsernames } from "@chief/auth/d1-users";
import { workspaceIdSchema } from "@chief/relay-contracts";

import type { OwnedAgentService } from "./owned-agent-service";
import type { MemberPrincipal } from "./owned-agent-shared";
import type { OwnedAgentRow } from "./queries/owned-agents/agents";
import { appendWorkspaceLogs } from "./workspace-log-store";

export async function owners(
  this: OwnedAgentService,
  userIds: readonly string[],
) {
  const owners = new Map<
    string,
    { username: string | null; name: string | null }
  >();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return owners;
  try {
    for (const row of await getUsernames(this.env.AUTH_DB, unique)) {
      owners.set(row.id, {
        username: row.username,
        name: row.name.trim() || null,
      });
    }
  } catch {
    // Without the account store no handle can be shown and nothing is approved.
  }
  return owners;
}

export function audit(
  this: OwnedAgentService,
  member: MemberPrincipal,
  operation: string,
  message: string,
  metadata: Record<string, string>,
  agentId?: string,
  conversationId?: string,
) {
  this.writeAudit(member.workspaceId, operation, message, {
    metadata: { ...metadata, actorUserId: member.userId },
    agentId,
    conversationId,
  });
}

export function auditAgent(
  this: OwnedAgentService,
  workspaceId: WorkspaceId,
  operation: string,
  message: string,
  agent: OwnedAgentRow,
) {
  this.writeAudit(workspaceId, operation, message, {
    metadata: {
      ownerUserId: agent.owner_user_id,
      actorAgentId: agent.agent_id,
    },
    agentId: agent.agent_id,
  });
}

export function writeAudit(
  this: OwnedAgentService,
  workspaceId: WorkspaceId,
  operation: string,
  message: string,
  detail: {
    metadata: Record<string, string>;
    agentId?: string | undefined;
    conversationId?: string | undefined;
  },
) {
  try {
    const id = crypto.randomUUID();
    appendWorkspaceLogs(this.storage, {
      logs: [
        {
          id,
          correlationId: id,
          workspaceId: workspaceIdSchema.parse(workspaceId),
          type: "info",
          operation,
          message,
          metadata: detail.metadata,
          createdAt: new Date().toISOString(),
          ...(detail.agentId ? { agentId: detail.agentId } : undefined),
          ...(detail.conversationId && detail.conversationId.length <= 64
            ? { conversationId: detail.conversationId }
            : undefined),
        },
      ],
    });
  } catch (error) {
    console.error("relay.owned_agents.audit_failed", {
      operation,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
