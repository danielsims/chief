import type { ChannelLocalToolContext } from "../channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "../channel-types.js";
import type { SessionManager } from "../manager.js";
import type { ChannelStore } from "./store.js";
import { defaultAgents, getAgent } from "../agents.js";

export function createChannelLocalToolContext(input: {
  manager: {
    store: { channelStore(): ChannelStore };
    raiseActionItem: SessionManager["raiseActionItem"];
  };
  workspaceId: string;
  caller: { agentId: string; chatId: string };
  broadcastChannels: () => void | Promise<void>;
  broadcastEvent: (event: ChannelEvent) => void | Promise<void>;
  broadcastWorkspaceData: () => void | Promise<void>;
  onAgentMentions?: ChannelLocalToolContext["onAgentMentions"];
  beforeMessagePost?: ChannelLocalToolContext["beforeMessagePost"];
  notifyDeletionRequest: (title: string) => void;
}): Promise<ChannelLocalToolContext> {
  // The agent-bound capability was already authenticated by the local-tools
  // route. Re-resolving identity from all busy sessions here made channel
  // calls become ambiguous as soon as Chief launched concurrent specialists.
  const agentId = input.caller.agentId;
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
    onAgentMentions: input.onAgentMentions,
    beforeMessagePost: input.beforeMessagePost,
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
