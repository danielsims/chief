import type {
  ChannelActorIdentity,
  ChannelAgentPermission,
} from "@chief/channel-api";

import type { WorkspaceChannel } from "./channel-types.js";
import { fail } from "./channel-local-tool-input.js";

export function ensureChannelPermission(
  channel: WorkspaceChannel,
  actor: ChannelActorIdentity,
  permission: ChannelAgentPermission,
) {
  if (actor.type !== "agent") return;
  if (!channel.agentIds.includes(actor.id)) {
    fail(
      `Join #${channel.name} before managing it.`,
      403,
      "not_a_channel_member",
    );
  }
  if (!channel.agentPermissions.includes(permission)) {
    fail(
      `The workspace owner has locked ${permission.replaceAll("_", " ")} for #${channel.name}.`,
      403,
      "channel_management_locked",
    );
  }
}
