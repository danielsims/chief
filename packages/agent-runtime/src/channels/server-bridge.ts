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
import { resolveChannelMessageId } from "./message-projection.js";
import {
  channelChatId,
  channelIdFromChatId,
  createChannelEvent,
  createChannelReaction,
} from "./nip29.js";

type Send = (message: ServerMessage) => void;
export type ChannelEventBroadcast = (
  workspaceId: string,
  event: ChannelEvent,
) => void;

/**
 * Shared-channel publication is explicit. Provider narration stays in the
 * private runtime transcript, while this tool writes the messages people see.
 */
export function channelPublicationInstructions(
  channelId: string,
  threadRootId?: string,
) {
  return [
    "Your ordinary assistant text is private working output and is not published into this shared channel.",
    `Publish each deliberate user-facing update with localTools.channelsMessagesPost using channelId ${JSON.stringify(channelId)}${threadRootId ? ` and threadRootId ${JSON.stringify(threadRootId)}` : ""}.`,
    "Only publish a useful acknowledgement, meaningful checkpoint, user action request, blocker, or verified result. Do not publish tool narration, planning notes, retries, or text such as ‘let me check’. Normal tool calls and their results remain visible in Activity.",
  ].join("\n");
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
  // Protocol references use the durable event hash. The client maps it back to
  // the transcript ID through the root event's `client` tag.
  const threadRootId = agentEvent.threadRootId
    ? resolveChannelMessageId(events, agentEvent.threadRootId)
    : undefined;
  const event = createChannelEvent({
    workspaceId,
    channelId,
    actor:
      agentEvent.role === "assistant"
        ? {
            type: "agent",
            id: assistantActor?.id ?? "chief",
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
              ? { type: "agent", id: "chief", name: "Chief" }
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
  missionControlChannelId?: string,
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
    channel.id === missionControlChannelId
      ? `This is the workspace's assigned mission channel, #${channel.name}. Every user post wakes Chief unless another member agent is explicitly addressed. Use it for direction, decisions, handoffs, and compact linked status. During onboarding, follow the exact opener and kickoff instructions without adding another acknowledgement. A named specialist acknowledges inside its kickoff thread, then keeps detailed work in its own subject channel; Setup and authentication stay in the private Setup conversation. Do not copy their working transcript, browser, files, or routine progress into this channel. Inspect those rooms before reporting one concise decision, blocker, or outcome that changes the wider plan. This convention grants no extra tool authority.`
      : "Ordinary channel posts are shared context and do not require an agent response. When your identity is addressed, answer directly as yourself in that message's thread. Keep the detailed work, browser sessions, files, and final result in that owning thread. After the user explicitly addresses you there, their later replies may remain routed to you without repeating the textual @mention; treat recipient metadata as the wake signal. If channel metadata updates are permitted, keep its topic or description concise and current when the work meaningfully changes, not after routine tool calls.";
  return [
    base,
    `You are working in Chief's shared #${channel.name} channel (${channel.id}).`,
    `The channel follows NIP-29 semantics and is shared with the user and these member agents: ${channel.agentIds.join(", ")}.`,
    "Treat its durable transcript as shared context. Preserve the user's conversational thread and publish the useful result in the channel and thread that own the work.",
    channelPublicationInstructions(channel.id),
    responseGuidance,
    "Use this agent pack's declared delegation tool so Chief can expose the specialist as an inspectable session. When localTools.specialistsDelegate is available, use it instead of provider-native or hidden background-agent features. Never imitate delegation with empty assistant messages.",
  ].join("\n\n");
}

export function agentForChannel(
  agent: AgentDefinition,
  purpose: string | undefined,
  channel: WorkspaceChannel | undefined,
  workspaceContext: string | undefined,
  missionControlChannelId?: string,
) {
  return {
    ...agent,
    instructions: composeWorkspaceInstructions(
      channelInstructions(
        agent.instructions,
        purpose,
        channel,
        missionControlChannelId,
      ),
      workspaceContext,
    ),
  };
}
