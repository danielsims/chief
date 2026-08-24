import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import { appendMessageCommandSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";

/** Publishes a completed cell result through the same permission and
 * conversation authorization boundary as a direct agent tool call. */
export async function publishAgentMessage(
  env: Env,
  job: AgentJob,
  message: {
    conversationId: string;
    threadRootId?: string;
    body: string;
    components?: {
      id: string;
      kind: string;
      version: number;
      payload: Record<string, unknown>;
    }[];
  },
  commandId: string,
  actorPubkey?: string,
) {
  const agent: AgentPrincipal = {
    kind: "agent",
    agentId: job.agentId,
    pubkey: (job.agentPubkey ?? actorPubkey)?.toLowerCase() ?? "0".repeat(64),
    workspaceId: job.workspaceId,
    role: "member",
  };
  const workspace = env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  );
  const authorization = await workspace.fetch(
    withTrustedContext(
      new Request(
        `https://workspace.internal?conversationId=${encodeURIComponent(message.conversationId)}`,
        {
          method: "POST",
          headers: {
            "x-chief-internal-operation": "authorize-conversation",
            "x-chief-required-permission": "messages.send",
          },
        },
      ),
      {
        principal: agent,
        requestId: commandId,
        workspaceId: job.workspaceId,
        conversationId: message.conversationId,
      },
    ),
  );
  if (!authorization.ok) {
    throw new HttpError(
      authorization.status,
      "job_conversation_denied",
      "The agent cannot publish to that conversation.",
    );
  }
  const command = appendMessageCommandSchema.parse({
    commandId,
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      messageId: crypto.randomUUID(),
      conversationId: message.conversationId,
      ...(message.threadRootId ? { threadRootId: message.threadRootId } : {}),
      body: message.body,
      components: message.components ?? [],
    },
  });
  const conversation = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(
      `${job.workspaceId}:${message.conversationId}`,
    ),
  );
  const response = await conversation.fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      }),
      {
        principal: agent,
        requestId: commandId,
        workspaceId: job.workspaceId,
        conversationId: message.conversationId,
      },
    ),
  );
  if (!response.ok) {
    throw new HttpError(
      502,
      "job_message_failed",
      "The agent's message could not be delivered.",
    );
  }
}
