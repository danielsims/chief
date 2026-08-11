import type { ChannelEvent } from "./channel-types.js";
import type { SessionManager } from "./manager.js";
import { createChannelEvent } from "./channels/nip29.js";

const GENERAL_INVITE_SOURCE = "chief-onboarding-general-invite";
const GENERAL_WELCOME_SOURCE = "chief-onboarding-general-welcome";

async function appendOnce(input: {
  manager: SessionManager;
  workspaceId: string;
  channelId: string;
  sourceId: string;
  event: () => ChannelEvent;
  broadcast: (event: ChannelEvent) => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  const existing = (
    await store.events(input.workspaceId, input.channelId)
  ).find((event) =>
    event.tags.some((tag) => tag[0] === "client" && tag[1] === input.sourceId),
  );
  if (existing) return existing;
  const event = input.event();
  await store.appendEvent(input.workspaceId, event);
  await input.broadcast(event);
  return event;
}

/** Invite the owner into General once and give the channel a useful tone. */
export async function ensureOnboardingGeneralChannel(input: {
  manager: SessionManager;
  workspaceId: string;
  broadcast: (event: ChannelEvent) => void | Promise<void>;
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

  const actor = { type: "agent" as const, id: "chief", name: "Chief" };
  await appendOnce({
    manager: input.manager,
    workspaceId: input.workspaceId,
    channelId: channel.id,
    sourceId: GENERAL_INVITE_SOURCE,
    event: () =>
      createChannelEvent({
        workspaceId: input.workspaceId,
        channelId: channel.id,
        actor,
        content: "Chief added you to the channel.",
        channelAction: {
          type: "member-added",
          agentIds: [],
          userIds: ["workspace-owner"],
        },
        sourceId: GENERAL_INVITE_SOURCE,
      }),
    broadcast: input.broadcast,
  });
  await appendOnce({
    manager: input.manager,
    workspaceId: input.workspaceId,
    channelId: channel.id,
    sourceId: GENERAL_WELCOME_SOURCE,
    event: () =>
      createChannelEvent({
        workspaceId: input.workspaceId,
        channelId: channel.id,
        actor,
        content:
          "Welcome to #general. Drop anything here that needs a home, and I’ll pull in the right people when it turns into real work.",
        sourceId: GENERAL_WELCOME_SOURCE,
      }),
    broadcast: input.broadcast,
  });
}
