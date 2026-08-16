import type { SessionManager } from "./manager.js";
import { createChannelEvent } from "./channels/nip29.js";

const MISSION_CONTROL_INVITE_SOURCE = "onboarding-chief-mission-invite";

/** Silently include the owner in General for legacy workspaces. */
export async function ensureOnboardingGeneralChannel(input: {
  manager: SessionManager;
  workspaceId: string;
  onChannelsChanged: () => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  let channel = (await store.list(input.workspaceId)).find(
    (candidate) => candidate.slug === "general",
  );
  if (!channel) return;

  if (!channel.userIds.includes("workspace-owner")) {
    channel =
      (await store.addUsers(input.workspaceId, channel.id, [
        "workspace-owner",
      ])) ?? channel;
    await input.onChannelsChanged();
  }
}

/** Add the owner to Mission Control when Chief starts onboarding. */
export async function inviteOwnerToMissionControl(input: {
  manager: SessionManager;
  workspaceId: string;
  channelId: string;
  onChannelsChanged: () => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  let channel = await store.get(input.workspaceId, input.channelId);
  if (!channel) return;

  const ownerWasMember = channel.userIds.includes("workspace-owner");
  if (!ownerWasMember) {
    channel =
      (await store.addUsers(input.workspaceId, channel.id, [
        "workspace-owner",
      ])) ?? channel;
  }

  const existingInvite = (
    await store.events(input.workspaceId, channel.id)
  ).some((event) =>
    event.tags.some(
      (tag) => tag[0] === "client" && tag[1] === MISSION_CONTROL_INVITE_SOURCE,
    ),
  );
  if (!existingInvite) {
    await store.appendEvent(
      input.workspaceId,
      createChannelEvent({
        workspaceId: input.workspaceId,
        channelId: channel.id,
        actor: { type: "agent", id: "chief", name: "Chief" },
        content: "Chief added you to the channel.",
        sourceId: MISSION_CONTROL_INVITE_SOURCE,
        channelAction: {
          type: "member-added",
          agentIds: [],
          userIds: ["workspace-owner"],
        },
      }),
    );
  }

  if (!ownerWasMember || !existingInvite) {
    await input.onChannelsChanged();
  }
  return channel;
}
