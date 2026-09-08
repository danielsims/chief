import type {
  ChannelEvent,
  ChiefMessageMetadata,
} from "@chief/agent-runtime/types";
import type { MessageComponent } from "@chief/relay-contracts";
import { channelMemberAddedPayloadSchema } from "@chief/relay-contracts";

function commaSeparatedIds(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isChannelMembershipMessage(message: {
  components: readonly MessageComponent[];
}) {
  return message.components.some(
    (component) => component.kind === "channel-action",
  );
}

export function channelActionFromComponent(
  component: MessageComponent,
): ChiefMessageMetadata["channelAction"] | undefined {
  if (component.kind !== "channel-action" || component.version !== 1) {
    return undefined;
  }
  const parsed = channelMemberAddedPayloadSchema.safeParse(component.payload);
  if (!parsed.success) return undefined;
  return {
    type: parsed.data.type,
    actorName: parsed.data.actorName,
    actorId: parsed.data.actorId,
    actorType: parsed.data.actorType,
    agentIds: commaSeparatedIds(parsed.data.agentIds),
    userIds: commaSeparatedIds(parsed.data.userIds),
  };
}

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
  currentUserId?: string,
) {
  const users = (action.userIds ?? []).map((userId) =>
    userId === "workspace-owner" || userId === currentUserId
      ? "you"
      : "a workspace member",
  );
  return [...new Set([...users, ...action.agentIds.map(agentName)])];
}

export function formatMembershipTargets(names: readonly string[]) {
  if (names.length < 2) return names[0] ?? "a workspace member";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
