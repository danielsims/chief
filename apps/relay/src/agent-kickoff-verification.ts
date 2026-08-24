import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import {
  channelDetailSchema,
  isJsonString,
  messagePageSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";

/** A specialist completion is accepted only after the relay itself shows its
 * threaded acknowledgement and public, owner-visible work channel. */
export async function validateSpecialistKickoff(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
) {
  const conversationId = job.payload.conversationId;
  const threadRootId = job.payload.threadRootId;
  if (!isJsonString(conversationId) || !isJsonString(threadRootId)) {
    throw new HttpError(
      409,
      "kickoff_evidence_missing",
      "The specialist kickoff is missing its relay targets.",
    );
  }
  const workspace = env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  );
  const channelResponse = await workspace.fetch(
    withTrustedContext(
      new Request(
        `https://workspace.internal/channels?conversationId=${encodeURIComponent(conversationId)}`,
        {
          method: "POST",
          headers: { "x-chief-internal-operation": "channels-get" },
        },
      ),
      {
        principal: agent,
        requestId: job.id,
        workspaceId: job.workspaceId,
      },
    ),
  );
  if (!channelResponse.ok) {
    throw new HttpError(
      409,
      "kickoff_channel_missing",
      "The specialist's work channel was not created.",
    );
  }
  const detail = channelDetailSchema.parse(await channelResponse.json());
  const ownsChannel = detail.members.some(
    (member) =>
      member.kind === "agent" &&
      member.principalId === agent.agentId &&
      member.role === "owner",
  );
  const ownerCanSeeChannel = detail.members.some(
    (member) => member.kind === "user",
  );
  const setupKickoff = job.kind === "workspace.kickoff.setup";
  const correctVisibility = setupKickoff
    ? detail.channel.isPrivate
    : !detail.channel.isPrivate;
  if (!correctVisibility || !ownsChannel || !ownerCanSeeChannel) {
    throw new HttpError(
      409,
      "kickoff_channel_incomplete",
      setupKickoff
        ? "Setup must continue in a private, agent-owned channel visible to the workspace owner."
        : "The specialist's channel must be public, agent-owned, and visible to the workspace owner.",
    );
  }

  const workConversation = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${job.workspaceId}:${conversationId}`),
  );
  const workMessagesResponse = await workConversation.fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages?limit=200"),
      {
        principal: agent,
        requestId: job.id,
        workspaceId: job.workspaceId,
        conversationId,
      },
    ),
  );
  const workMessages = workMessagesResponse.ok
    ? messagePageSchema.parse(await workMessagesResponse.json()).messages
    : [];
  const arrivedInWorkChannel = workMessages.some(
    (message) =>
      message.author.kind === "agent" &&
      message.author.id === agent.agentId &&
      !message.threadRootId,
  );
  if (!arrivedInWorkChannel) {
    throw new HttpError(
      409,
      "kickoff_work_channel_entry_missing",
      "The specialist did not begin work in its own channel.",
    );
  }

  const missionControl = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${job.workspaceId}:mission-control`),
  );
  const messagesResponse = await missionControl.fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages?limit=200"),
      {
        principal: agent,
        requestId: job.id,
        workspaceId: job.workspaceId,
        conversationId: "mission-control",
      },
    ),
  );
  const messages = messagesResponse.ok
    ? messagePageSchema.parse(await messagesResponse.json()).messages
    : [];
  const acknowledged = messages.some(
    (message) =>
      message.author.kind === "agent" &&
      message.author.id === agent.agentId &&
      message.threadRootId === threadRootId,
  );
  if (!acknowledged) {
    throw new HttpError(
      409,
      "kickoff_acknowledgement_missing",
      "The specialist did not reply in its Mission Control kickoff thread.",
    );
  }
}
