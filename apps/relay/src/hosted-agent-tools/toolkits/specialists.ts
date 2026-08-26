import type { AgentJob, JsonObject } from "@chief/relay-contracts";
import { getAgent } from "@chief/agent-runtime/agents";

import { HttpError } from "../../http";
import { withTrustedContext } from "../../internal-context";
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
      if (!response.ok) {
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
  const conversationId =
    optionalString(input, "channelId") ??
    requiredString(input, "conversationId");
  const threadRootId = optionalString(input, "threadRootId");
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
