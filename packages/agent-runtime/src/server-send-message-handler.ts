import type { HandleSendMessageOptions } from "./server-send-message-types.js";
import type { AgentEvent } from "./types.js";
import { getAgent } from "./agents.js";
import {
  channelReplyThreadRoot,
  channelRespondingAgentId,
} from "./channel-reply-routing.js";
import { AddressedChannelReplyFallback } from "./channel-response-fallback.js";
import * as channelBridge from "./channels/server-bridge.js";
import {
  normalizedExecution,
  safeMessageAttachments,
} from "./server-message-helpers.js";
import { debugSendMessage } from "./server-send-message-debug.js";
import { sendMessagePromptContext } from "./server-send-message-prompt.js";
import { activateRequestedIntegrationSetup } from "./server-send-message-setup.js";
import { setupSkillFromPrompt } from "./setup-skills.js";
import { ensureExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import { readWorkspaceContext } from "./workspace-context.js";
import { readWorkspaceWaysOfWorking } from "./workspace-ways-of-working.js";

export async function handleSendMessage({
  authorizeWorkspace,
  bindRootSession,
  broadcastChannelEvent,
  chatDestinations,
  ensureChiefSession,
  integrationSetups,
  manager,
  msg,
  pluginMcpServers,
  send,
}: HandleSendMessageOptions) {
  await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
  await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
  const attachments = safeMessageAttachments(msg.attachments);
  const destinationId = chatDestinations.get(
    `${msg.workspaceId}\0${msg.chatId}`,
  );
  const destinationChannel = destinationId
    ? await manager.store.channelStore().get(msg.workspaceId, destinationId)
    : undefined;
  const newAgentIds = (msg.mentions ?? []).filter(
    (agentId) => !destinationChannel?.agentIds.includes(agentId),
  );
  if (destinationChannel && newAgentIds.length > 0) {
    await manager.store
      .channelStore()
      .addAgents(msg.workspaceId, destinationChannel.id, newAgentIds);
    send({
      type: "channels",
      workspaceId: msg.workspaceId,
      channels: await manager.store.channelStore().list(msg.workspaceId),
    });
  }
  let openedSession = (await manager.rootChat(msg.workspaceId, msg.chatId))
    .session;
  if (!openedSession) {
    const restored = await ensureChiefSession(
      msg.workspaceId,
      msg.chatId,
      msg.executorCapability,
    ).catch(() => undefined);
    if (!restored) {
      return send({
        type: "error",
        message: "No session for this chat yet. Reopen it to reconnect.",
        chatId: msg.chatId,
      });
    }
    openedSession = restored;
    bindRootSession(msg.workspaceId, msg.chatId, restored);
    send({
      type: "chatOpened",
      workspaceId: msg.workspaceId,
      chatId: msg.chatId,
      visibility: "user",
      agentId: restored.agent.id,
      execution: {
        driver: restored.config.driver,
        model: restored.config.model,
      },
    });
  }
  if (newAgentIds.length > 0) {
    const senderName = msg.senderName?.trim();
    const actorName = senderName?.length ? senderName : "You";
    const names = newAgentIds.map(
      (agentId) => getAgent(agentId)?.name ?? agentId,
    );
    const membershipText = `${actorName} added ${names.join(", ")} to the channel.`;
    const membershipId = `${msg.messageId}:member-added`;
    const membershipEvent = {
      type: "message",
      id: membershipId,
      role: "user",
      content: [{ type: "text", text: membershipText }],
      mentions: newAgentIds,
      channelAction: {
        type: "member-added",
        actorName,
        actorId: "workspace-owner",
        actorType: "user",
        agentIds: newAgentIds,
      },
    } satisfies AgentEvent;
    await channelBridge.mirrorEvent(
      manager,
      send,
      msg.workspaceId,
      msg.chatId,
      membershipEvent,
      destinationChannel?.id,
      undefined,
      broadcastChannelEvent,
    );
    openedSession.recordUserMessage(membershipText, membershipId, {
      mentions: newAgentIds,
      channelAction: {
        type: "member-added",
        actorName,
        actorId: "workspace-owner",
        actorType: "user",
        agentIds: newAgentIds,
      },
    });
    await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
    const persistedMembership = (
      await manager.messages(msg.workspaceId, msg.chatId)
    ).find((message) => message.id === membershipId);
    if (persistedMembership) {
      send({
        type: "message",
        workspaceId: msg.workspaceId,
        chatId: msg.chatId,
        message: persistedMembership,
      });
    }
  }
  const isSharedChannel = destinationChannel?.visibility !== "direct";
  const respondingAgentId = channelRespondingAgentId({
    channelId: destinationChannel?.id,
    defaultAgentId:
      destinationChannel?.visibility === "private"
        ? destinationChannel.agentIds.find((agentId) => agentId !== "chief")
        : undefined,
    isSharedChannel,
    missionControlChannelId: readWorkspaceWaysOfWorking(msg.workspaceId)
      .missionControlChannelId,
    mentions: msg.mentions,
  });
  const channelReplyFallback =
    respondingAgentId && destinationChannel
      ? new AddressedChannelReplyFallback()
      : undefined;
  const shouldPreempt = [msg.interruptActive, openedSession.isBusy].some(
    Boolean,
  );
  const recordedBeforeExecution = Boolean(isSharedChannel) || shouldPreempt;
  if (recordedBeforeExecution) {
    openedSession.recordUserMessage(msg.text, msg.messageId, {
      threadRootId: msg.threadRootId,
      mentions: msg.mentions,
      attachments,
    });
    await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
    const persistedMessage = (
      await manager.messages(msg.workspaceId, msg.chatId)
    ).find((message) => message.id === msg.messageId);
    if (persistedMessage) {
      send({
        type: "message",
        workspaceId: msg.workspaceId,
        chatId: msg.chatId,
        message: persistedMessage,
      });
    }
  }
  let channelMessageMirrored = false;
  if (respondingAgentId && destinationChannel) {
    if (!getAgent(respondingAgentId)) {
      throw new Error(
        `${respondingAgentId} persona is missing from this workspace.`,
      );
    }
    const targetEvent = await channelBridge.mirrorEvent(
      manager,
      send,
      msg.workspaceId,
      msg.chatId,
      {
        type: "message",
        id: msg.messageId,
        role: "user",
        content: [
          ...(msg.text ? [{ type: "text" as const, text: msg.text }] : []),
          ...(attachments ?? []).map((attachment) => ({
            type: "image" as const,
            ...attachment,
          })),
        ],
        threadRootId: msg.threadRootId,
        mentions: msg.mentions,
      },
      destinationChannel.id,
      undefined,
      broadcastChannelEvent,
    );
    channelMessageMirrored = Boolean(targetEvent);
  }
  if (isSharedChannel && !respondingAgentId) {
    return;
  }
  if (shouldPreempt) {
    try {
      await openedSession.interrupt();
    } catch (error) {
      console.error("[runtime] interrupt before follow-up:", error);
    } finally {
      manager.releaseExecution(msg.workspaceId, msg.chatId, "interactive");
    }
  }
  let releaseExecution: (() => void) | undefined;
  let session = openedSession;
  let releaseOnTerminal:
    | { session: typeof session; listener: (event: AgentEvent) => void }
    | undefined;
  try {
    releaseExecution = await manager.acquireExecutionWhenAvailable(
      msg.workspaceId,
      msg.chatId,
      "interactive",
    );
    const setupSkill = setupSkillFromPrompt(msg.text);
    if (setupSkill?.domain) {
      integrationSetups.assignDomain(
        msg.workspaceId,
        msg.chatId,
        setupSkill.domain,
      );
    }
    const executorWorkspace = await ensureExecutorWorkspace(
      msg.workspaceId,
      msg.executorCapability,
    );
    const pluginServers = await pluginMcpServers(msg.workspaceId);
    session = await manager.ensureRootChat(session.agent, msg.chatId, {
      ...session.config,
      mcpServers: [
        executorToolServer(
          executorWorkspace,
          integrationSetups.domain(msg.workspaceId, msg.chatId)
            ? "browser"
            : session.config.access === "full"
              ? "model"
              : "browser",
        ),
        ...pluginServers,
      ],
    });
    bindRootSession(msg.workspaceId, msg.chatId, session);
    await activateRequestedIntegrationSetup({
      capability: msg.executorCapability,
      chatId: msg.chatId,
      integrationSetups,
      setupSkill,
      text: msg.text,
      workspaceId: msg.workspaceId,
    });
    const execution = normalizedExecution(msg.execution);
    if (respondingAgentId && destinationChannel) {
      const respondingAgent = getAgent(respondingAgentId);
      if (!respondingAgent) {
        throw new Error(
          `${respondingAgentId} persona is missing from this workspace.`,
        );
      }
      if (!channelMessageMirrored) {
        await channelBridge.mirrorEvent(
          manager,
          send,
          msg.workspaceId,
          msg.chatId,
          {
            type: "message",
            id: msg.messageId,
            role: "user",
            content: [
              ...(msg.text ? [{ type: "text" as const, text: msg.text }] : []),
              ...(attachments ?? []).map((attachment) => ({
                type: "image" as const,
                ...attachment,
              })),
            ],
            threadRootId: msg.threadRootId,
            mentions: msg.mentions,
          },
          destinationChannel.id,
          undefined,
          broadcastChannelEvent,
        );
      }
      const preference =
        (await manager.agentPreference(msg.workspaceId, respondingAgentId)) ??
        (await manager.agentPreference(msg.workspaceId, "chief"));
      const effectiveAgent = channelBridge.agentForChannel(
        respondingAgent,
        undefined,
        await manager.store
          .channelStore()
          .get(msg.workspaceId, destinationChannel.id),
        readWorkspaceContext(msg.workspaceId),
        readWorkspaceWaysOfWorking(msg.workspaceId).missionControlChannelId,
      );
      session = await manager.switchRootChatAgent(effectiveAgent, msg.chatId, {
        ...session.config,
        driver: preference?.driver ?? session.config.driver,
        model: preference?.model ?? session.config.model,
      });
      bindRootSession(msg.workspaceId, msg.chatId, session);
    }
    if (
      execution &&
      (execution.driver !== session.config.driver ||
        execution.model !== session.config.model)
    ) {
      session = await manager.switchRootChatExecution(
        session.agent,
        msg.chatId,
        {
          ...session.config,
          driver: execution.driver,
          model: execution.model,
        },
      );
      bindRootSession(msg.workspaceId, msg.chatId, session);
    }
    const replyThreadRootId = channelReplyThreadRoot({
      isSharedChannel: Boolean(isSharedChannel),
      mentions: msg.mentions,
      messageId: msg.messageId,
      text: msg.text,
      threadRootId: msg.threadRootId,
    });
    const listenForTerminal = (targetSession: typeof session) => {
      const terminalListener = (event: AgentEvent) => {
        channelReplyFallback?.observe(event);
        if (
          event.type === "result" ||
          event.type === "error" ||
          event.type === "exit"
        ) {
          targetSession.off("event", terminalListener);
          releaseExecution?.();
          releaseExecution = undefined;
          const fallback = channelReplyFallback?.completed(event);
          if (fallback && respondingAgentId && destinationChannel) {
            const respondingAgent = getAgent(respondingAgentId);
            if (respondingAgent) {
              void channelBridge
                .mirrorEvent(
                  manager,
                  send,
                  msg.workspaceId,
                  msg.chatId,
                  {
                    ...fallback,
                    id: fallback.id ?? `${msg.messageId}:addressed-reply`,
                    threadRootId: fallback.threadRootId ?? replyThreadRootId,
                  },
                  destinationChannel.id,
                  { id: respondingAgent.id, name: respondingAgent.name },
                  broadcastChannelEvent,
                )
                .catch((error: unknown) =>
                  console.error(
                    "[runtime] addressed channel reply fallback:",
                    error,
                  ),
                );
            }
          }
        }
      };
      releaseOnTerminal = {
        session: targetSession,
        listener: terminalListener,
      };
      targetSession.on("event", terminalListener);
    };
    listenForTerminal(session);
    debugSendMessage({
      chatId: msg.chatId,
      threadRootId: msg.threadRootId,
      mentions: msg.mentions,
      shared: isSharedChannel,
      resolvedThreadRootId: replyThreadRootId,
    });
    const promptContext = sendMessagePromptContext({
      threadRootId: replyThreadRootId,
      mentions: msg.mentions,
      attachments,
      setupSkill,
      publicationInstructions:
        destinationChannel && destinationChannel.visibility !== "direct"
          ? channelBridge.channelPublicationInstructions(
              destinationChannel.id,
              replyThreadRootId,
            )
          : undefined,
      channelCoordinates: destinationChannel
        ? channelBridge.channelMessageCoordinates(
            destinationChannel.id,
            msg.messageId,
          )
        : undefined,
    });
    let producedOutput = await session.sendPrompt(
      msg.text,
      msg.messageId,
      !recordedBeforeExecution,
      promptContext,
    );
    if (!producedOutput) {
      console.error(
        `[runtime] ${msg.chatId} completed without agent output; starting a fresh provider continuation.`,
      );
      const recoveryAgent = session.agent;
      const recoveryConfig = session.config;
      session = await manager.restartRootChatContinuation(
        recoveryAgent,
        msg.chatId,
        recoveryConfig,
      );
      bindRootSession(msg.workspaceId, msg.chatId, session);
      releaseExecution = await manager.acquireExecutionWhenAvailable(
        msg.workspaceId,
        msg.chatId,
        "interactive",
      );
      listenForTerminal(session);
      producedOutput = await session.sendPrompt(
        msg.text,
        msg.messageId,
        false,
        promptContext,
      );
      if (!producedOutput) {
        throw new Error(
          "The agent completed without a reply after reconnecting. Please try again.",
        );
      }
    }
  } catch (error) {
    if (releaseOnTerminal) {
      releaseOnTerminal.session.off("event", releaseOnTerminal.listener);
    }
    releaseExecution?.();
    throw error;
  }
}
