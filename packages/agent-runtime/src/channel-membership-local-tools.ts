import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { WorkspaceChannel } from "./channel-types.js";
import { getAgent } from "./agents.js";
import { fail, validatedAgentIds } from "./channel-local-tool-input.js";
import { createChannelEvent } from "./channels/nip29.js";

export interface RequestedMembers {
  agentIds: string[];
  userIds: string[];
}

export function requestedMembers(
  body: Record<string, unknown>,
  availableAgentIds: readonly string[],
  required: boolean,
): RequestedMembers {
  if (body.members === undefined) {
    return {
      agentIds: validatedAgentIds(body.agentIds, availableAgentIds, required),
      userIds: [],
    };
  }
  if (!Array.isArray(body.members) || (required && body.members.length === 0)) {
    fail(
      "members must contain at least one workspace member.",
      400,
      "invalid_members",
    );
  }
  const agentIds: string[] = [];
  const userIds: string[] = [];
  for (const member of body.members) {
    if (!member || !isJsonObject(member) || Array.isArray(member)) {
      fail("Each member must include type and id.", 400, "invalid_members");
    }
    const value = member as Record<string, unknown>;
    if (value.type === "user" && value.id === "workspace-owner") {
      userIds.push(value.id);
      continue;
    }
    if (value.type !== "agent" || !isJsonString(value.id)) {
      fail(
        "Only existing workspace users and agents can be added to channels.",
        400,
        "member_not_in_workspace",
      );
    }
    agentIds.push(value.id);
  }
  return {
    agentIds: validatedAgentIds(agentIds, availableAgentIds, false),
    userIds: [...new Set(userIds)],
  };
}

function membershipTargetNames(
  agentIds: readonly string[],
  userIds: readonly string[],
) {
  return [
    ...(userIds.includes("workspace-owner") ? ["you"] : []),
    ...agentIds.map((agentId) => getAgent(agentId)?.name ?? agentId),
  ];
}

function joinedNames(names: readonly string[]) {
  if (names.length < 2) return names[0] ?? "a workspace member";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

export async function emitMemberAddedEvent(input: {
  context: ChannelLocalToolContext;
  workspaceId: string;
  channel: WorkspaceChannel;
  agentIds: string[];
  userIds: string[];
  sourceId?: string;
}) {
  const { context, workspaceId, channel, agentIds, userIds, sourceId } = input;
  if (agentIds.length === 0 && userIds.length === 0) return;
  if (sourceId) {
    const existing = (
      await context.channelStore.events(workspaceId, channel.id)
    ).find((event) =>
      event.tags.some((tag) => tag[0] === "client" && tag[1] === sourceId),
    );
    if (existing) return;
  }
  const targets = joinedNames(membershipTargetNames(agentIds, userIds));
  const event = createChannelEvent({
    workspaceId,
    channelId: channel.id,
    actor: context.actor,
    content: `${context.actor.name} added ${targets} to the channel.`,
    mentions: agentIds,
    channelAction: { type: "member-added", agentIds, userIds },
    sourceId,
  });
  await context.channelStore.appendEvent(workspaceId, event);
  await context.onChannelEvent?.(event);
}
