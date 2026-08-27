import type { DriverType, WorkspaceChannel } from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { WORKSPACE_AGENT_IDENTITIES } from "../lib/workspace-channels";

function isDriverType(value: string): value is DriverType {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "opencode" ||
    value === "remote"
  );
}

export function requestedDriver(value: string | null): DriverType | undefined {
  return value && isDriverType(value) ? value : undefined;
}

export function isWorkspaceAgentId(
  value: string | null,
): value is WorkspaceAgentId {
  return value !== null && Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, value);
}

export function isNewConversation(
  activeChatId: string | null,
  isChannel: boolean,
  chatsLoading: boolean,
  hasChatEntry: boolean,
) {
  return Boolean(activeChatId && !isChannel && !chatsLoading && !hasChatEntry);
}

export function channelReferences(channels: readonly WorkspaceChannel[]) {
  return channels
    .filter((channel) => channel.visibility !== "direct")
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
    }));
}
