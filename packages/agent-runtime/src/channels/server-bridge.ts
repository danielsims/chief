import type { ChannelEvent, ChannelMessageEvent } from "../channel-types.js";
import type { SessionManager } from "../manager.js";
import type {
  AgentDefinition,
  AgentEvent,
  ClientMessage,
  ServerMessage,
  WorkspaceChannel,
} from "../types.js";
import { composeWorkspaceInstructions } from "../agents.js";
import {
  channelChatId,
  channelIdFromChatId,
  createChannelEvent,
  createChannelReaction,
  GETTING_STARTED_CHANNEL_ID,
} from "./nip29.js";

type Send = (message: ServerMessage) => void;
export type ChannelEventBroadcast = (
  workspaceId: string,
  event: ChannelEvent,
) => void;

export type ChannelAssistantMessage = Extract<
  AgentEvent,
  { type: "message" }
> & { role: "assistant" };

export interface ChannelTurnMirrorState {
  pending?: ChannelAssistantMessage;
  terminal: boolean;
}

export function isUserFacingChannelMessage(
  event: AgentEvent,
): event is ChannelAssistantMessage {
  return (
    event.type === "message" &&
    event.role === "assistant" &&
    event.content.some(
      (block) =>
        block.type === "image" ||
        (block.type === "text" && block.text.trim().length > 0),
    )
  );
}

export function advanceChannelTurnMirror(
  current: ChannelTurnMirrorState,
  event: AgentEvent,
): { state: ChannelTurnMirrorState; schedule: boolean } {
  if (event.type === "message" && event.role === "user") {
    return { state: { terminal: false }, schedule: false };
  }
  if (isUserFacingChannelMessage(event)) {
    return {
      state: { ...current, pending: event },
      schedule: current.terminal,
    };
  }
  if (event.type === "result") {
    if (!event.ok) return { state: { terminal: false }, schedule: false };
    const state = { ...current, terminal: true };
    return { state, schedule: Boolean(state.pending) };
  }
  if (event.type === "error" || event.type === "exit") {
    return { state: { terminal: false }, schedule: false };
  }
  return { state: current, schedule: false };
}

export async function mirrorEvent(
  manager: SessionManager,
  send: Send,
  workspaceId: string,
  chatId: string,
  agentEvent: AgentEvent,
  explicitChannelId?: string,
  assistantActor?: { id: string; name: string },
  broadcast?: ChannelEventBroadcast,
): Promise<ChannelMessageEvent | undefined> {
  const channelId = explicitChannelId ?? channelIdFromChatId(chatId);
  if (!channelId || agentEvent.type !== "message") return;
  const content = agentEvent.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  if (!content && !agentEvent.content.some((block) => block.type === "image"))
    return;
  const channelStore = manager.store.channelStore();
  const events = await channelStore.events(workspaceId, channelId);
  const existing = agentEvent.id
    ? events.find(
        (event): event is ChannelMessageEvent =>
          event.kind === 9 &&
          event.tags.some(
            (tag) => tag[0] === "client" && tag[1] === agentEvent.id,
          ),
      )
    : undefined;
  if (existing) return existing;
  const threadRootId = agentEvent.threadRootId
    ? (events.find((event) =>
        event.tags.some(
          (tag) => tag[0] === "client" && tag[1] === agentEvent.threadRootId,
        ),
      )?.id ?? agentEvent.threadRootId)
    : undefined;
  const event = createChannelEvent({
    workspaceId,
    channelId,
    actor:
      agentEvent.role === "assistant"
        ? {
            type: "agent",
            id: assistantActor?.id ?? "cmo",
            name: assistantActor?.name ?? "Chief",
          }
        : { type: "user", id: "workspace-owner", name: "You" },
    content,
    parts: agentEvent.content,
    sourceId: agentEvent.id,
    mentions: agentEvent.mentions,
    channelAction: agentEvent.channelAction,
    threadRootId,
  });
  await channelStore.appendEvent(workspaceId, event);
  if (broadcast) broadcast(workspaceId, event);
  else send({ type: "channelEvent", workspaceId, event });
  return event;
}

export async function sendChannels(
  manager: SessionManager,
  workspaceId: string,
  send: Send,
) {
  send({
    type: "channels",
    workspaceId,
    channels: await manager.store.channelStore().list(workspaceId),
  });
}

async function sendChannelEvents(
  manager: SessionManager,
  workspaceId: string,
  channelId: string,
  send: Send,
) {
  send({
    type: "channelEvents",
    workspaceId,
    channelId,
    events: await manager.store.channelStore().events(workspaceId, channelId),
  });
}

export async function beginAgentActivityReaction(
  manager: SessionManager,
  send: Send,
  workspaceId: string,
  channelId: string,
  targetEventId: string,
  agent: { id: string; name: string },
) {
  const reaction = createChannelReaction({
    workspaceId,
    channelId,
    targetEventId,
    actor: { type: "agent", ...agent },
    reaction: "👀",
  });
  await manager.store.channelStore().appendEvent(workspaceId, reaction);
  send({ type: "channelEvent", workspaceId, event: reaction });
  return reaction.id;
}

export async function endAgentActivityReaction(
  manager: SessionManager,
  send: Send,
  workspaceId: string,
  channelId: string,
  reactionId: string,
) {
  await manager.store.channelStore().removeEvent(workspaceId, reactionId);
  await sendChannelEvents(manager, workspaceId, channelId, send);
}

export async function channelForChat(
  manager: SessionManager,
  workspaceId: string,
  chatId: string,
  explicitChannelId?: string,
) {
  const channelId = explicitChannelId ?? channelIdFromChatId(chatId);
  if (!channelId) return undefined;
  const channel = await manager.store
    .channelStore()
    .get(workspaceId, channelId);
  if (!channel) throw new Error("Channel was not found in this workspace.");
  return channel;
}

export async function handleRequest(
  manager: SessionManager,
  message: ClientMessage,
  send: Send,
) {
  if (message.type === "listChannels") {
    await sendChannels(manager, message.workspaceId, send);
    return true;
  }
  if (message.type === "listChannelEvents") {
    await sendChannelEvents(
      manager,
      message.workspaceId,
      message.channelId,
      send,
    );
    return true;
  }
  if (message.type === "createChannel") {
    const channel = await manager.store
      .channelStore()
      .create(message.workspaceId, {
        name: message.name,
        description: message.description,
      });
    send({
      type: "channelCreated",
      requestId: message.requestId,
      workspaceId: message.workspaceId,
      channel,
    });
    await sendChannels(manager, message.workspaceId, send);
    return true;
  }
  if (message.type === "updateChannelAgents") {
    await manager.store
      .channelStore()
      .setAgents(message.workspaceId, message.channelId, message.agentIds);
    await sendChannels(manager, message.workspaceId, send);
    return true;
  }
  if (message.type === "reactToChannelMessage") {
    const reaction = message.reaction.trim().slice(0, 32);
    if (!reaction) return true;
    const events = await manager.store
      .channelStore()
      .events(message.workspaceId, message.channelId);
    let target = events.find(
      (event) =>
        event.kind === 9 &&
        (event.id === message.messageId ||
          event.tags.some(
            (tag) => tag[0] === "client" && tag[1] === message.messageId,
          )),
    );
    if (!target) {
      const storedMessage = (
        await manager.messages(
          message.workspaceId,
          channelChatId(message.workspaceId, message.channelId),
        )
      ).find((candidate) => candidate.id === message.messageId);
      const content = storedMessage?.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (storedMessage && content) {
        target = createChannelEvent({
          workspaceId: message.workspaceId,
          channelId: message.channelId,
          actor:
            storedMessage.role === "assistant"
              ? { type: "agent", id: "cmo", name: "Chief" }
              : { type: "user", id: "workspace-owner", name: "You" },
          content,
          parts: storedMessage.parts,
          sourceId: storedMessage.id,
          createdAt: storedMessage.metadata?.createdAt,
        });
        await manager.store
          .channelStore()
          .appendEvent(message.workspaceId, target);
      }
    }
    if (!target) {
      await sendChannelEvents(
        manager,
        message.workspaceId,
        message.channelId,
        send,
      );
      return true;
    }
    const existing = events.find(
      (event) =>
        event.kind === 7 &&
        event.actor.type === "user" &&
        event.actor.id === "workspace-owner" &&
        event.content === reaction &&
        event.tags.some((tag) => tag[0] === "e" && tag[1] === target.id),
    );
    if (existing) {
      await manager.store
        .channelStore()
        .removeEvent(message.workspaceId, existing.id);
    } else {
      await manager.store.channelStore().appendEvent(
        message.workspaceId,
        createChannelReaction({
          workspaceId: message.workspaceId,
          channelId: message.channelId,
          targetEventId: target.id,
          actor: { type: "user", id: "workspace-owner", name: "You" },
          reaction,
        }),
      );
    }
    await sendChannelEvents(
      manager,
      message.workspaceId,
      message.channelId,
      send,
    );
    return true;
  }
  return false;
}

export function chatTitle(
  purpose: string | undefined,
  integrationDomain: string | undefined,
  channel: WorkspaceChannel | undefined,
) {
  if (purpose === "integration-setup") {
    return integrationDomain === "analytics.google.com"
      ? "Google Analytics setup"
      : "Integration setup";
  }
  return channel ? `#${channel.name}` : "";
}

export async function openRootChat(
  manager: SessionManager,
  message: {
    workspaceId: string;
    chatId: string;
    purpose?: string;
    integrationDomain?: string;
    channelId?: string;
  },
  driver: Parameters<SessionManager["createRootChat"]>[3],
  model: string | undefined,
  agentId: string,
) {
  const channel = await channelForChat(
    manager,
    message.workspaceId,
    message.chatId,
    message.channelId,
  );
  const storedChat = await manager.createRootChat(
    message.workspaceId,
    message.chatId,
    chatTitle(message.purpose, message.integrationDomain, channel),
    driver,
    model,
    agentId,
  );
  return { channel, storedChat };
}

export function channelInstructions(
  baseInstructions: string,
  purpose: string | undefined,
  channel: WorkspaceChannel | undefined,
) {
  const base =
    purpose === "integration-setup"
      ? `${baseInstructions}\n\nThis is a user-started integration setup run. Perform the setup directly. Do not delegate to another agent. Finish all safe local setup and verification yourself, and ask only for information that cannot be discovered.`
      : baseInstructions;
  if (!channel) return base;
  if (channel.visibility === "direct") {
    return [
      base,
      `You are in a private direct conversation with the user (${channel.id}).`,
      "Answer as the selected agent, keep this transcript private to its participants, and do not redirect the user into a public channel.",
    ].join("\n\n");
  }
  const responseGuidance =
    channel.id === GETTING_STARTED_CHANNEL_ID
      ? "This private setup channel is an active conversation: every user post wakes Chief unless another member agent is explicitly addressed. Lead the setup conversationally, read onboarding/getting-started.md for the selected work, involve Setup through visible delegation when useful, and ask before opening browser authentication or making consequential changes."
      : "Ordinary channel posts are shared context and do not require an agent response. When your identity is addressed, answer directly as yourself in that message's thread. After the user explicitly addresses you in a thread, their subsequent replies in that thread may remain routed to you without repeating the textual @mention; treat recipient metadata as the wake signal and keep the response in that thread.";
  return [
    base,
    `You are working in Chief's shared #${channel.name} channel (${channel.id}).`,
    `The channel follows NIP-29 semantics and is shared with the user and these member agents: ${channel.agentIds.join(", ")}.`,
    "Treat its durable transcript as shared context. Delegate to the relevant member agent when specialist ownership helps, preserve the user's conversational thread, and bring the useful result back into this same channel.",
    responseGuidance,
    "Use this agent pack's declared delegation tool so Chief can expose the specialist as an inspectable session. When localTools.specialistsDelegate is available, use it instead of provider-native or hidden background-agent features. Never imitate delegation with empty assistant messages.",
  ].join("\n\n");
}

export function agentForChannel(
  agent: AgentDefinition,
  purpose: string | undefined,
  channel: WorkspaceChannel | undefined,
  workspaceContext: string | undefined,
) {
  return {
    ...agent,
    instructions: composeWorkspaceInstructions(
      channelInstructions(agent.instructions, purpose, channel),
      workspaceContext,
    ),
  };
}
