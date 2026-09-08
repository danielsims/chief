import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import {
  channelCreateCommandSchema,
  channelMemberAddCommandSchema,
  channelMembersResultSchema,
} from "@chief/relay-contracts";

import {
  deterministicUuid,
  workspaceOperation,
} from "./hosted-agent-tools/toolkits/channels";
import { HttpError } from "./http";

interface SpecialistKickoff {
  agentId: string;
  operationKey: string;
  payload: { conversationId: string };
}

export async function ensureKickoffWorkChannel(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
  entry: SpecialistKickoff,
  conversationId: string,
) {
  await workspaceOperation(env, job, agent, "channels-create", {
    body: channelCreateCommandSchema.parse({
      commandId: await deterministicUuid(
        `${job.id}:${entry.operationKey}:channel`,
      ),
      protocolVersion: 1,
      occurredAt: job.createdAt,
      payload: {
        conversationId,
        name:
          entry.agentId === "setup" ? "Setup" : entry.payload.conversationId,
        isPrivate: entry.agentId === "setup",
      },
    }),
  });
  const owner = await missionControlOwnerId(env, job, agent);
  await workspaceOperation(env, job, agent, "channels-members-add", {
    body: channelMemberAddCommandSchema.parse({
      commandId: await deterministicUuid(
        `${job.id}:${entry.operationKey}:members`,
      ),
      protocolVersion: 1,
      occurredAt: job.createdAt,
      payload: {
        conversationId,
        members: [
          { kind: "user", principalId: owner },
          { kind: "agent", principalId: entry.agentId },
        ],
      },
    }),
  });
}

async function missionControlOwnerId(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
) {
  const missionControl = channelMembersResultSchema.parse(
    await workspaceOperation(env, job, agent, "channels-members-list", {
      conversationId: "mission-control",
    }),
  );
  const owner = missionControl.members.find(
    (member) => member.kind === "user" && member.role === "owner",
  );
  if (!owner) {
    throw new HttpError(
      502,
      "workspace_owner_missing",
      "Chief could not find the workspace owner for kickoff.",
    );
  }
  return owner.principalId;
}
