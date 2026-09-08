import type { DriverType, WorkspaceChannel } from "@chief/agent-runtime/types";

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

export function channelVisibility(visibility: string | undefined) {
  return visibility === "private" ? ("private" as const) : ("public" as const);
}

export function isWorkspaceAgentId(
  value: string | null,
  agents: readonly { id: string }[] = [],
) {
  return (
    value !== null &&
    (Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, value) ||
      agents.some((agent) => agent.id === value))
  );
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
