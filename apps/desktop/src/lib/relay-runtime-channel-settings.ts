import type { ClientMessage, ServerMessage } from "@chief/agent-runtime/types";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

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
