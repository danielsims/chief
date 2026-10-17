import type { ClientMessage, ServerMessage } from "@chief/agent-runtime/types";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { agentIdSchema } from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";
import { loadRelayWorkspaceChannels } from "./relay-runtime-channels";
import { parseRelayError } from "./relay-runtime-errors";

type ChannelSettingsMessage = Extract<
  ClientMessage,
  { type: "updateChannel" | "setChannelArchived" | "deleteChannel" }
>;

/** Applies a channel settings change on the relay and answers with the same
 * replies the local runtime sends, so the UI works unchanged. */
export async function applyRelayChannelSettings(
  relay: RelayRuntimeRelay,
  snapshot: WorkspaceSnapshot,
  message: ChannelSettingsMessage,
  emit: (message: ServerMessage) => void,
) {
  const { requestId, workspaceId, channelId } = message;
  try {
    if (message.type === "deleteChannel") {
      await relay.channelSettings.delete(channelId);
      emit({ type: "channelDeleted", requestId, workspaceId, channelId });
      return;
    }
    if (message.type === "setChannelArchived") {
      await relay.channelSettings.setArchived(channelId, message.archived);
    } else {
      await relay.channelSettings.update(channelId, {
        name: message.name,
        ...(message.visibility
          ? { isPrivate: message.visibility === "private" }
          : undefined),
      });
    }
    const { channels } = await loadRelayWorkspaceChannels(relay, snapshot);
    emit({ type: "channels", workspaceId, channels });
    const channel = channels.find((candidate) => candidate.id === channelId);
    if (channel)
      emit({ type: "channelUpdated", requestId, workspaceId, channel });
  } catch (error) {
    const failure = parseRelayError(error).message;
    emit(
      message.type === "deleteChannel"
        ? {
            type: "channelDeleteFailed",
            requestId,
            workspaceId,
            channelId,
            message: failure,
          }
        : {
            type: "channelUpdateFailed",
            requestId,
            workspaceId,
            channelId,
            message: failure,
          },
    );
  }
}

/** Makes a channel's agent members match the chosen agents, then answers with
 * the refreshed channel list. People in the channel are left alone. */
export async function applyRelayChannelAgents(
  relay: RelayRuntimeRelay,
  snapshot: WorkspaceSnapshot,
  message: Extract<ClientMessage, { type: "updateChannelAgents" }>,
  emit: (message: ServerMessage) => void,
) {
  const { channelId, agentIds } = message;
  const current = new Set<string>(
    (await relay.listChannelMembers(channelId)).flatMap((member) =>
      member.kind === "agent" ? [member.principalId] : [],
    ),
  );
  const added = agentIds
    .filter((agentId) => !current.has(agentId))
    .map((agentId) => agentIdSchema.parse(agentId));
  if (added.length > 0) {
    await relay.addChannelMembers(
      channelId,
      added.map((principalId) => ({ kind: "agent" as const, principalId })),
    );
  }
  for (const agentId of current) {
    if (agentIds.includes(agentId)) continue;
    await relay.removeChannelMember(channelId, {
      kind: "agent",
      principalId: agentId,
    });
  }
  const { channels } = await loadRelayWorkspaceChannels(relay, snapshot);
  emit({ type: "channels", workspaceId: message.workspaceId, channels });
}
