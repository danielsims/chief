import type { ChannelLocalToolContext } from "../channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "../channel-types.js";
import type { SessionManager } from "../manager.js";
import { defaultAgents, getAgent } from "../agents.js";

export function createChannelLocalToolContext(input: {
  manager: SessionManager;
  workspaceId: string;
  requestedSession?: string;
  broadcastChannels: () => void | Promise<void>;
  broadcastEvent: (event: ChannelEvent) => void | Promise<void>;
  broadcastWorkspaceData: () => void | Promise<void>;
  notifyDeletionRequest: (title: string) => void;
}): Promise<ChannelLocalToolContext | undefined> {
  const active = input.manager.activeAgentSession(
    input.workspaceId,
    input.requestedSession,
  );
  if (!active) return Promise.resolve(undefined);
  const agentId = active.agentId;
  const definition = getAgent(agentId);

  return Promise.resolve({
    actor: {
      type: "agent",
      id: agentId,
      name: definition?.name ?? agentId,
    },
    channelStore: input.manager.store.channelStore(),
    availableAgentIds: defaultAgents.map((agent) => agent.id),
    onChannelsChanged: input.broadcastChannels,
    onChannelEvent: input.broadcastEvent,
    requestDeletion: async (channel: WorkspaceChannel, reason, actor) => {
      const item = {
        id: `channel-delete-${channel.id}`,
        agentId: actor.id,
        title: `Delete #${channel.name}?`,
        reason,
        sourceId: channel.id,
        status: "open" as const,
        createdAt: Date.now(),
      };
      await input.manager.raiseActionItem(input.workspaceId, item);
      await input.broadcastWorkspaceData();
      input.notifyDeletionRequest(
        `${actor.name} asked to delete #${channel.name}`,
      );
      return item;
    },
  });
}
