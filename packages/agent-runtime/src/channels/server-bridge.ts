import type { SessionManager } from "../manager.js";
import type {
  AgentDefinition,
  AgentEvent,
  ClientMessage,
  ServerMessage,
  WorkspaceChannel,
} from "../types.js";
import { composeWorkspaceInstructions } from "../agents.js";
import { channelIdFromChatId, createChannelEvent } from "./nip29.js";

type Send = (message: ServerMessage) => void;

export async function mirrorEvent(
  manager: SessionManager,
  send: Send,
  workspaceId: string,
  chatId: string,
  agentEvent: AgentEvent,
  explicitChannelId?: string,
  assistantActor?: { id: string; name: string },
) {
  const channelId = explicitChannelId ?? channelIdFromChatId(chatId);
  if (!channelId || agentEvent.type !== "message") return;
  const content = agentEvent.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  if (!content) return;
  const threadRootId = agentEvent.threadRootId
    ? ((await manager.store.channelStore().events(workspaceId, channelId)).find(
        (event) =>
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
    threadRootId,
  });
  await manager.store.channelStore().appendEvent(workspaceId, event);
  send({
    type: "channelEvent",
    workspaceId,
    event,
  });
}

async function sendChannels(
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
    await manager.store.channelStore().create(message.workspaceId, {
      name: message.name,
      description: message.description,
    });
    await sendChannels(manager, message.workspaceId, send);
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
  return [
    base,
    `You are working in Chief's shared #${channel.name} channel (${channel.id}).`,
    `The channel follows NIP-29 semantics and is shared with the user and these member agents: ${channel.agentIds.join(", ")}.`,
    "Treat its durable transcript as shared context. Delegate to the relevant member agent when specialist ownership helps, preserve the user's conversational thread, and bring the useful result back into this same channel.",
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
