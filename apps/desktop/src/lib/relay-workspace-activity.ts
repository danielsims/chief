import type { SessionRecord } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";
import { messagePreviewText, parseJsonString } from "@chief/relay-contracts";

export async function loadRelayWorkspaceActivity(
  relay: Pick<RelayClient, "listAgentJobs">,
  snapshot: WorkspaceSnapshot,
): Promise<SessionRecord[]> {
  const agentIds = snapshot.agents
    .filter((agent) => agent.runtime.kind === "native-cell")
    .flatMap((agent) => [
      agent.id,
      ...agent.subagents.map((child) => child.id),
    ]);
  const pages = await Promise.all(
    agentIds.map(async (agentId) => {
      try {
        return await relay.listAgentJobs(agentId);
      } catch (cause) {
        if (
          cause instanceof RelayClientError &&
          (cause.status === 403 || cause.status === 404)
        )
          return [];
        throw cause;
      }
    }),
  );
  return pages
    .flat()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 100)
    .map((job) => ({
      id: job.id,
      parentId: parseJsonString(job.payload.conversationId),
      triggerId:
        parseJsonString(job.payload.threadRootId) ??
        parseJsonString(job.payload.messageId),
      triggerContext: job.payload,
      kind: "task",
      visibility: "user",
      agent: job.agentId,
      title: messagePreviewText(
        parseJsonString(job.payload.instruction) ?? job.kind,
      ).slice(0, 160),
      provider: "relay",
      status:
        job.status === "leased"
          ? "running"
          : job.status === "pending"
            ? "waiting"
            : job.status,
      attempt: job.attempt,
      ...(job.lastError ? { error: job.lastError } : undefined),
      createdAt: Date.parse(job.createdAt),
      updatedAt: Date.parse(job.updatedAt),
      ...(job.status === "completed" || job.status === "failed"
        ? { finishedAt: Date.parse(job.updatedAt) }
        : undefined),
    }));
}
