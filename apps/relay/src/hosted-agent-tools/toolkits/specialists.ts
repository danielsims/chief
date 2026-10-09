import type {
  AgentJob,
  AgentPrincipal,
  JsonObject,
} from "@chief/relay-contracts";
import { getAgent } from "@chief/agent-runtime/agents";

import { HttpError } from "../../http";
import { withTrustedContext } from "../../internal-context";
import { releaseInternalResponse } from "../../internal-response";
import { optionalString, requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { deterministicUuid } from "./channels";

export const hostedSpecialistTools = [
  defineHostedAgentTool(
    "specialists.delegate",
    async ({ env, job, principal }, input) => {
      const agentId = requiredString(input, "agentId");
      const caller = getAgent(job.agentId);
      if (!caller?.delegates?.includes(agentId)) {
        throw new HttpError(
          403,
          "specialist_delegation_denied",
          `${job.agentId} cannot delegate work to ${agentId}.`,
        );
      }
      const delegation = await specialistDelegationCommand(job, input);
      await requireDelegationTarget(
        env,
        job,
        principal,
        delegation.conversationId,
      );
      const response = await env.AGENTS.get(
        env.AGENTS.idFromName(`${job.workspaceId}:${agentId}`),
      ).fetch(
        withTrustedContext(
          new Request("https://agent.internal/ensure", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(delegation.command),
          }),
          {
            principal,
            requestId: delegation.command.commandId,
            workspaceId: job.workspaceId,
            conversationId: delegation.conversationId,
          },
        ),
      );
      const enqueued = response.ok;
      await releaseInternalResponse(response);
      if (!enqueued) {
        throw new HttpError(
          502,
          "specialist_delegation_failed",
          `The ${agentId} job could not be queued.`,
        );
      }
      return {
        status: "working",
        delegationId: delegation.delegationId,
        agentId,
        jobId: delegation.jobId,
      };
    },
    { effect: "idempotent" },
  ),
];

export async function specialistDelegationCommand(
  job: AgentJob,
  input: JsonObject,
  now = new Date().toISOString(),
) {
  const agentId = requiredString(input, "agentId");
  const delegationId = requiredString(input, "delegationId");
  const currentConversationId = optionalString(job.payload, "conversationId");
  const conversationId =
    optionalString(input, "channelId") ??
    optionalString(input, "conversationId") ??
    currentConversationId;
  if (!conversationId) throw new Error("conversationId is required.");
  // Work delegated from a thread reports back into that same thread unless the
  // caller deliberately routes it elsewhere.
  const threadRootId =
    optionalString(input, "threadRootId") ??
    (conversationId === currentConversationId
      ? optionalString(job.payload, "threadRootId")
      : undefined);
  const commandId = await deterministicUuid(
    `${job.id}:delegation:${delegationId}:${agentId}:command`,
  );
  const delegatedJobId = await deterministicUuid(
    `${job.id}:delegation:${delegationId}:${agentId}:job`,
  );
  return {
    delegationId,
    conversationId,
    jobId: delegatedJobId,
    command: {
      commandId,
      protocolVersion: 1,
      occurredAt: now,
      payload: {
        id: delegatedJobId,
        agentId,
        kind: "agent.delegation",
        payload: {
          conversationId,
          ...(threadRootId ? { threadRootId } : undefined),
          title: requiredString(input, "title"),
          instruction: requiredString(input, "task"),
          delegatedBy: job.agentId,
          parentJobId: job.id,
          delegationId,
          ...(optionalString(input, "setupDomain")
            ? { setupDomain: optionalString(input, "setupDomain") }
            : undefined),
          ...(optionalString(input, "setupAttemptId")
            ? { setupAttemptId: optionalString(input, "setupAttemptId") }
            : undefined),
        },
        availableAt: now,
      },
    },
  };
}

/**
 * Delegated work must land somewhere people can see it. Only the current
 * conversation, or one the delegating agent may post to, is accepted, so a
 * guessed id (such as a person's id) fails loudly instead of running unseen.
 */
async function requireDelegationTarget(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  conversationId: string,
) {
  if (conversationId === optionalString(job.payload, "conversationId")) return;
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(
        `https://workspace.internal?conversationId=${encodeURIComponent(conversationId)}`,
        {
          method: "POST",
          headers: {
            "x-chief-internal-operation": "authorize-conversation",
            "x-chief-required-permission": "messages.send",
          },
        },
      ),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        conversationId,
      },
    ),
  );
  const authorized = response.ok;
  await releaseInternalResponse(response);
  if (!authorized) {
    throw new HttpError(
      404,
      "delegation_conversation_unknown",
      `"${conversationId}" is not a conversation you can post to. Delegate into the current conversation by omitting conversationId, or find a channel id with channels_list.`,
    );
  }
}
