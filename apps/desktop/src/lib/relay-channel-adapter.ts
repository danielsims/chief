import type { WorkspaceChannel } from "@chief/agent-runtime/types";
import type {
  ChannelMember,
  ChannelMembership,
  ChannelRecord,
} from "@chief/relay-contracts";

const CHANNEL_CHAT_PREFIX = "channel:";

/** Resolve a desktop UI chat key to the strict conversation id owned by the relay. */
export function relayConversationId(
  chatId: string,
  explicitConversationId?: string,
) {
  if (explicitConversationId) return explicitConversationId;
  if (!chatId.startsWith(CHANNEL_CHAT_PREFIX)) return chatId;
  const scoped = chatId.slice(CHANNEL_CHAT_PREFIX.length);
  return scoped.slice(scoped.lastIndexOf(":") + 1);
}

const CURRENT_USER_ID = "workspace-owner";

export function workspaceChannelFromRelay(
  channel: ChannelRecord,
  members: readonly ChannelMember[],
  currentMembership: ChannelMembership | undefined,
): WorkspaceChannel {
  const currentPrincipalId = currentMembership?.principalId;
  const owner = members.find((member) => member.role === "owner");
  const createdAt = Date.parse(channel.createdAt);
  return {
    protocol: "nip29",
    id: channel.id,
    slug: slugify(channel.name),
    name: channel.name,
    topic: "",
    description: "",
    agentIds: members
      .filter((member) => member.kind === "agent")
      .map((member) => member.principalId),
    userIds: members
      .filter((member) => member.kind === "user")
      .map((member) =>
        member.principalId === currentPrincipalId
          ? CURRENT_USER_ID
          : member.principalId,
      ),
    visibility: channel.isPrivate ? "private" : "public",
    kind: "standard",
    lifecycle: channel.archived ? "archived" : "active",
    createdBy: owner
      ? {
          type: owner.kind,
          id:
            owner.kind === "user" && owner.principalId === currentPrincipalId
              ? CURRENT_USER_ID
              : owner.principalId,
          name:
            owner.name ?? (owner.kind === "user" ? "You" : owner.principalId),
        }
      : { type: "user", id: CURRENT_USER_ID, name: "You" },
    agentPermissions: [],
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "channel"
  );
}
