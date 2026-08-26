import type {
  AgentId,
  AgentJob,
  AgentPrincipal,
  JsonObject,
} from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  isJsonString,
} from "@chief/relay-contracts";

import { dispatchPersistedMessage } from "./conversation-agent-dispatch";
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
    mentions?: AgentId[];
    components?: {
      id: string;
      kind: string;
      version: number;
      payload: JsonObject;
    }[];
  },
  commandId: string,
  actorPubkey?: string,
) {
  const body = normalizeAgentMessageBody(message.body);
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
      ...(message.threadRootId
        ? { threadRootId: message.threadRootId }
        : undefined),
      body,
      mentions: message.mentions ?? [],
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
        headers: {
          "content-type": "application/json",
          "x-chief-workflow-id": isJsonString(job.payload.workflowId)
            ? job.payload.workflowId
            : job.id,
        },
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
  const result = appendMessageResultSchema.parse(await response.json());
  // Onboarding kickoff messages are the single wake for the specialist cells:
  // the dedicated workspace.kickoff.* job (enqueued by `enqueueKickoff`) is the
  // authoritative, cross-platform run. Dispatch their mentions here would also
  // enqueue a competing conversation.message job into mission-control, so the
  // agent would run the kickoff twice and dump its work there. Do not double-
  // dispatch during onboarding. Every other agent-authored mention still wakes
  // its target as normal.
  if (job.kind === "workspace.onboarding") return;
  const dispatch = await dispatchPersistedMessage(env, {
    message: result.message,
    principal: agent,
    requestId: commandId,
    workspaceId: job.workspaceId,
    conversationId: message.conversationId,
    workflowId: isJsonString(job.payload.workflowId)
      ? job.payload.workflowId
      : job.id,
  });
  if (!dispatch.ok) {
    throw new HttpError(
      502,
      "job_dispatch_failed",
      "The addressed agents could not be queued.",
    );
  }
}

export function normalizeAgentMessageBody(body: string) {
  return body.replaceAll(/\s*—\s*/gu, ", ");
}
