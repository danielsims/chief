import type {
  ChannelEvent,
  ChiefMessageMetadata,
} from "@chief/agent-runtime/types";

export function channelActionFromEvent(
  event: ChannelEvent,
): ChiefMessageMetadata["channelAction"] | undefined {
  if (
    event.kind !== 9 ||
    !event.tags.some((tag) => tag[0] === "action" && tag[1] === "member-added")
  ) {
    return undefined;
  }
  return {
    type: "member-added",
    actorName: event.actor.name,
    actorId: event.actor.id,
    actorType: event.actor.type,
    agentIds: event.tags.flatMap((tag) =>
      tag[0] === "agent" && tag[1] ? [tag[1]] : [],
    ),
    userIds: event.tags.flatMap((tag) =>
      tag[0] === "user" && tag[1] ? [tag[1]] : [],
    ),
  };
}

export function channelMembershipTargetNames(
  action: NonNullable<ChiefMessageMetadata["channelAction"]>,
  agentName: (agentId: string) => string,
) {
  return [
    ...((action.userIds ?? []).includes("workspace-owner") ? ["you"] : []),
    ...action.agentIds.map(agentName),
  ];
}

export function formatMembershipTargets(names: readonly string[]) {
  if (names.length < 2) return names[0] ?? "a workspace member";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
