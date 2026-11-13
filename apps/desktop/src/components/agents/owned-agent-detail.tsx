import type { WorkspaceChannel } from "@chief/agent-runtime/types";
import type { OwnedAgent } from "@chief/relay-contracts";

import type { OwnedAgentsState } from "./owned-agents-panel";
import { ownedAgentDefinition } from "../../lib/owned-agent-presentation";
import { AgentDetail } from "./agent-detail";

/** An agent that joined from its own host, on the same page as the rest. */
export function OwnedAgentDetail({
  agent: owned,
  state,
  workspaceId,
  channels,
  ready,
  onClose,
}: {
  agent: OwnedAgent;
  state: OwnedAgentsState;
  workspaceId: string | null;
  channels: readonly WorkspaceChannel[];
  ready: boolean;
  onClose: () => void;
}) {
  const { client, run, refresh } = state;
  const agentChannels = channels.map((channel) => {
    const member = owned.channels.some((entry) => entry.id === channel.id);
    const others = channel.agentIds.filter((id) => id !== owned.id);
    return { ...channel, agentIds: member ? [...others, owned.id] : others };
  });
  return (
    <AgentDetail
      agent={ownedAgentDefinition(owned)}
      owned={{
        online: owned.online,
        lastSeenAt: owned.lastSeenAt,
        onRename: async (displayName) => {
          if (!client) throw new Error("Chief is still connecting.");
          await client.renameOwnedAgent(owned.id, displayName);
          await refresh();
        },
      }}
      workspaceId={workspaceId}
      preferences={[]}
      channels={agentChannels}
      ready={ready && Boolean(client) && !state.busy}
      saving={state.busy}
      preferenceError={null}
      relayClient={client}
      onAgentChanged={refresh}
      onSave={() => undefined}
      onApplyExecutionToTeam={() => undefined}
      onUpdateChannelAgents={(channelId, agentIds) =>
        void run(async () => {
          await client?.setOwnedAgentChannel(
            owned.id,
            channelId,
            agentIds.includes(owned.id),
          );
        })
      }
      onRemove={async (agentId) => {
        if (!client) throw new Error("Chief is still connecting.");
        await client.revokeOwnedAgent(agentId);
        await refresh();
        onClose();
      }}
    />
  );
}
