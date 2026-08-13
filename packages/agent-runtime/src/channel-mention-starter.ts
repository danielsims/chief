import { createHash } from "node:crypto";

import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import type { SessionManager } from "./manager.js";
import { agentSkillFromPrompt } from "./agent-skills.js";
import { getAgent } from "./agents.js";
import { channelChatId, createChannelEvent } from "./channels/nip29.js";
import { runSpecialistDelegation } from "./specialist-delegation.js";

const ONBOARDING_HOME_CHANNELS: Readonly<Record<string, string>> = {
  brand: "marketing",
  engineer: "engineering",
  prospector: "prospecting",
  setup: "setup",
};

const SETUP_CHANNEL_OPERATION_KEY = "chief-onboarding-private-setup";

export function isOnboardingMention(event: ChannelEvent) {
  return event.tags.some(
    (tag) =>
      tag[0] === "client" &&
      tag[1]?.startsWith("channel-api:onboarding-") === true,
  );
}

/** Use the stable client message ID that the desktop renders as the root. */
export function channelMentionThreadRoot(event: ChannelEvent) {
  return event.tags.find((tag) => tag[0] === "client")?.[1] ?? event.id;
}

async function appendOnce(input: {
  manager: SessionManager;
  workspaceId: string;
  channel: WorkspaceChannel;
  sourceId: string;
  actor: { type: "agent"; id: string; name: string };
  content: string;
  threadRootId?: string;
  channelAction?: {
    type: "member-added";
    agentIds: string[];
    userIds: string[];
  };
  onChannelEvent?: (event: ChannelEvent) => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  const existing = (
    await store.events(input.workspaceId, input.channel.id)
  ).find((event) =>
    event.tags.some((tag) => tag[0] === "client" && tag[1] === input.sourceId),
  );
  if (existing) return existing;
  const event = createChannelEvent({
    workspaceId: input.workspaceId,
    channelId: input.channel.id,
    actor: input.actor,
    content: input.content,
    sourceId: input.sourceId,
    ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
    ...(input.channelAction ? { channelAction: input.channelAction } : {}),
  });
  await store.appendEvent(input.workspaceId, event);
  await input.onChannelEvent?.(event);
  return event;
}

export async function ensureOnboardingHomeChannel(input: {
  manager: SessionManager;
  workspaceId: string;
  agentId: string;
  onChannelsChanged?: () => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  const slug = ONBOARDING_HOME_CHANNELS[input.agentId];
  if (!slug) return undefined;
  const existing = (await store.list(input.workspaceId)).find(
    (channel) => channel.slug === slug,
  );
  if (existing) {
    if (input.agentId !== "setup") return existing;
    const setupActor = { type: "agent" as const, id: "setup", name: "Setup" };
    let channel = existing;
    let changed = false;
    if (channel.visibility !== "private") {
      channel = await store.update(input.workspaceId, channel.id, {
        visibility: "private",
        actor: setupActor,
      });
      changed = true;
    }
    if (
      channel.agentIds.length !== 2 ||
      !["setup", "chief"].every((agentId) => channel.agentIds.includes(agentId))
    ) {
      channel =
        (await store.setAgents(input.workspaceId, channel.id, [
          "setup",
          "chief",
        ])) ?? channel;
      changed = true;
    }
    if (
      channel.userIds.length !== 1 ||
      channel.userIds[0] !== "workspace-owner"
    ) {
      channel =
        (await store.setUsers(input.workspaceId, channel.id, [
          "workspace-owner",
        ])) ?? channel;
      changed = true;
    }
    if (changed) {
      await input.onChannelsChanged?.();
    }
    return channel;
  }
  if (input.agentId === "setup") {
    const create = () =>
      store.create(input.workspaceId, {
        name: "setup",
        description: "Private workspace connections and account setup",
        visibility: "private",
        operationKey: SETUP_CHANNEL_OPERATION_KEY,
        actor: { type: "agent", id: "setup", name: "Setup" },
        agentIds: ["setup", "chief"],
        userIds: ["workspace-owner"],
        agentPermissions: [
          "update_metadata",
          "manage_members",
          "manage_workstream",
          "archive",
        ],
      });
    let channel: WorkspaceChannel;
    try {
      channel = await create();
    } catch (error) {
      const concurrent = (await store.list(input.workspaceId)).find(
        (candidate) => candidate.slug === slug,
      );
      if (!concurrent) throw error;
      channel = concurrent;
    }
    await input.onChannelsChanged?.();
    return channel;
  }
  if (input.agentId !== "brand" && input.agentId !== "engineer") {
    return undefined;
  }
  const engineering = input.agentId === "engineer";
  const channel = await store.create(input.workspaceId, {
    name: engineering ? "engineering" : "marketing",
    description: engineering
      ? "Product changes, bugs, and technical reviews"
      : "Positioning, brand, content, and growth",
    operationKey: engineering
      ? "chief-default-engineering"
      : "chief-default-marketing",
    actor: engineering
      ? { type: "agent", id: "engineer", name: "Engineer" }
      : { type: "agent", id: "brand", name: "Marketer" },
    agentIds: engineering
      ? ["chief", "engineer"]
      : ["chief", "brand", "content"],
    agentPermissions: [
      "update_metadata",
      "manage_members",
      "manage_workstream",
      "archive",
    ],
  });
  await input.onChannelsChanged?.();
  return channel;
}

async function startOnboardingAgentWork(
  input: Parameters<typeof startMentionedAgentThreads>[0],
  agentId: string,
) {
  const specialist = getAgent(agentId);
  if (!specialist) return;
  let homeChannel = await ensureOnboardingHomeChannel({
    manager: input.manager,
    workspaceId: input.workspaceId,
    agentId,
    onChannelsChanged: input.onChannelsChanged,
  });
  if (!homeChannel) throw new Error(`${specialist.name} has no work channel.`);

  const ownerWasMember = homeChannel.userIds.includes("workspace-owner");
  if (!ownerWasMember && homeChannel.visibility !== "direct") {
    homeChannel =
      (await input.manager.store
        .channelStore()
        .addUsers(input.workspaceId, homeChannel.id, ["workspace-owner"])) ??
      homeChannel;
    await input.onChannelsChanged?.();
  }

  const originConversationId = channelChatId(
    input.workspaceId,
    input.channel.id,
  );
  const originThreadRootId = channelMentionThreadRoot(input.event);
  const homeConversationId = channelChatId(input.workspaceId, homeChannel.id);
  const sourcePrefix =
    input.event.tags.find((tag) => tag[0] === "client")?.[1] ?? input.event.id;
  const actor = {
    type: "agent" as const,
    id: agentId,
    name: specialist.name,
  };
  const destination =
    homeChannel.visibility === "direct"
      ? "our private Setup chat"
      : `#${homeChannel.name}`;

  await appendOnce({
    manager: input.manager,
    workspaceId: input.workspaceId,
    channel: input.channel,
    sourceId: `${sourcePrefix}:ack:${agentId}`,
    actor,
    content: `I’m on it. I’ve started this in ${destination}.`,
    threadRootId: originThreadRootId,
    onChannelEvent: input.onChannelEvent,
  });

  if (agentId === "setup") {
    await appendOnce({
      manager: input.manager,
      workspaceId: input.workspaceId,
      channel: homeChannel,
      sourceId: `${sourcePrefix}:setup-members`,
      actor,
      content: "Setup added you and Chief to the channel.",
      channelAction: {
        type: "member-added",
        agentIds: ["chief"],
        userIds: ["workspace-owner"],
      },
      onChannelEvent: input.onChannelEvent,
    });
  }

  if (homeChannel.visibility !== "direct" && !ownerWasMember) {
    await appendOnce({
      manager: input.manager,
      workspaceId: input.workspaceId,
      channel: homeChannel,
      sourceId: `${sourcePrefix}:owner-invite:${agentId}`,
      actor,
      content: `${specialist.name} added you to the channel.`,
      channelAction: {
        type: "member-added",
        agentIds: [],
        userIds: ["workspace-owner"],
      },
      onChannelEvent: input.onChannelEvent,
    });
  }

  const skill = agentSkillFromPrompt(agentId, input.event.content);
  const workSourceId = `${sourcePrefix}:work:${agentId}`;
  await appendOnce({
    manager: input.manager,
    workspaceId: input.workspaceId,
    channel: homeChannel,
    sourceId: workSourceId,
    actor,
    content: skill
      ? `I’m starting [chief-skill:${skill.id}] now. I’ll keep the work and final update in this thread.`
      : "I’m starting this now. I’ll keep the work and final update in this thread.",
    onChannelEvent: input.onChannelEvent,
  });

  await input.manager.createRootChat(
    input.workspaceId,
    homeConversationId,
    homeChannel.visibility === "direct"
      ? homeChannel.name
      : `#${homeChannel.name}`,
  );
  const delegationId = `mention-${createHash("sha256")
    .update(`${input.event.id}\0${agentId}`)
    .digest("hex")
    .slice(0, 20)}`;
  return runSpecialistDelegation({
    manager: input.manager,
    workspaceId: input.workspaceId,
    conversationId: homeConversationId,
    delegationId,
    agentId,
    title: skill?.label ?? specialist.name,
    task: input.event.content,
    channelId: homeChannel.id,
    threadRootId: workSourceId,
    originConversationId,
    originThreadRootId,
    initialReview: true,
    onStateChange: input.onStateChange,
    onFilesChange: input.onFilesChange,
    onChannelEvent: input.onChannelEvent,
  });
}

export function startMentionedAgentThreads(input: {
  manager: SessionManager;
  workspaceId: string;
  callerAgentId: string;
  channel: WorkspaceChannel;
  event: ChannelEvent;
  agentIds: readonly string[];
  onStateChange: () => void | Promise<void>;
  onFilesChange: () => void | Promise<void>;
  onChannelEvent?: (event: ChannelEvent) => void | Promise<void>;
  onChannelsChanged?: () => void | Promise<void>;
}) {
  if (input.callerAgentId !== "chief" || input.event.kind !== 9) return;
  const conversationId = channelChatId(input.workspaceId, input.channel.id);
  const threadRootId = channelMentionThreadRoot(input.event);
  for (const agentId of input.agentIds) {
    if (agentId === "chief" || !getAgent(agentId)) continue;
    if (isOnboardingMention(input.event)) {
      void startOnboardingAgentWork(input, agentId).catch((error: unknown) =>
        console.error(
          `[channel-mention] ${agentId} onboarding handoff failed:`,
          error,
        ),
      );
      continue;
    }
    const delegationId = `mention-${createHash("sha256")
      .update(`${input.event.id}\0${agentId}`)
      .digest("hex")
      .slice(0, 20)}`;
    const skill = agentSkillFromPrompt(agentId, input.event.content);
    void runSpecialistDelegation({
      manager: input.manager,
      workspaceId: input.workspaceId,
      conversationId,
      delegationId,
      agentId,
      title:
        skill?.label ??
        input.event.content
          .replace(/^\[chief-skill:[a-z0-9-]+]$/gim, "")
          .trim()
          .slice(0, 120),
      task: input.event.content,
      channelId: input.channel.id,
      threadRootId,
      initialReview: isOnboardingMention(input.event),
      onStateChange: input.onStateChange,
      onFilesChange: input.onFilesChange,
    }).catch((error: unknown) =>
      console.error(`[channel-mention] ${agentId} failed to start:`, error),
    );
  }
}
