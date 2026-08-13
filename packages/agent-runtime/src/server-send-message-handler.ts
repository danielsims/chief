import type { ChannelEvent } from "./channel-types.js";
import type { IntegrationSetupRegistry } from "./integration-setup-state.js";
import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type { AgentEvent, ClientMessage, ServerMessage } from "./types.js";
import { getAgent } from "./agents.js";
import {
  channelReplyThreadRoot,
  channelRespondingAgentId,
} from "./channel-reply-routing.js";
import * as channelBridge from "./channels/server-bridge.js";
import {
  normalizedExecution,
  safeMessageAttachments,
  SETUP_ATTEMPT_PREFIX,
} from "./server-message-helpers.js";
import { setupSkillFromPrompt } from "./setup-skills.js";
import {
  ensureExecutorWorkspace,
  prepareIntegrationSetup,
} from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import { readWorkspaceContext } from "./workspace-context.js";
import { readWorkspaceWaysOfWorking } from "./workspace-ways-of-working.js";

type Message = Extract<ClientMessage, { type: "sendMessage" }>;

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
}: {
  authorizeWorkspace: (
    workspaceId: string,
    capability: Message["executorCapability"],
  ) => Promise<unknown>;
  bindRootSession: (
    workspaceId: string,
    chatId: string,
    session: AgentSession,
  ) => void;
  broadcastChannelEvent: (workspaceId: string, event: ChannelEvent) => void;
  chatDestinations: Map<string, string>;
  ensureChiefSession: (
    workspaceId: string,
    chatId: string,
    capability: Message["executorCapability"],
  ) => Promise<AgentSession>;
  integrationSetups: IntegrationSetupRegistry;
  manager: SessionManager;
  msg: Message;
  pluginMcpServers: (
    workspaceId: string,
  ) => Promise<import("./types.js").McpServerSpec[]>;
  send: (message: ServerMessage) => void;
}) {
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
    // Restore durable provider state after an in-memory session ends.
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
  // Follow-ups are durable before any interruption or execution
  // wait. That keeps the user's message visible even if stopping the
  // active provider takes a moment or fails and must fall back to a
  // normal wait.
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
  let agentActivity: { channelId: string; reactionId: string } | undefined;
  let channelMessageMirrored = false;
  if (respondingAgentId && destinationChannel) {
    const respondingAgent = getAgent(respondingAgentId);
    if (!respondingAgent) {
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
    if (targetEvent) {
      try {
        agentActivity = {
          channelId: destinationChannel.id,
          reactionId: await channelBridge.beginAgentActivityReaction(
            manager,
            send,
            msg.workspaceId,
            destinationChannel.id,
            targetEvent.id,
            {
              id: respondingAgent.id,
              name: respondingAgent.name,
            },
          ),
        };
      } catch (error) {
        console.error("[runtime] agent activity reaction:", error);
      }
    }
  }
  if (isSharedChannel && !respondingAgentId) {
    return;
  }
  const finishAgentActivity = async () => {
    const current = agentActivity;
    agentActivity = undefined;
    if (!current) return;
    await channelBridge.endAgentActivityReaction(
      manager,
      send,
      msg.workspaceId,
      current.channelId,
      current.reactionId,
    );
  };
  if (shouldPreempt) {
    try {
      await openedSession.interrupt();
    } catch (error) {
      // The follow-up is already durable. If the provider cannot be
      // interrupted cleanly, execution acquisition below waits for
      // its terminal event instead of dropping the user's message.
      console.error("[runtime] interrupt before follow-up:", error);
    } finally {
      manager.releaseExecution(msg.workspaceId, msg.chatId, "interactive");
    }
  }
  let releaseExecution: (() => void) | undefined;
  let session = openedSession;
  let releaseOnTerminal: ((event: AgentEvent) => void) | undefined;
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
    // A chat can be opened while its isolated Executor daemon is
    // still recovering. Never let that one transient failure leave
    // a long-lived provider continuation without Chief's internal
    // tools: reattach the current workspace tool server immediately
    // before every turn that is actually addressed to an agent.
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
    const firstLine = msg.text.split("\n", 1)[0] ?? "";
    if (firstLine.startsWith(SETUP_ATTEMPT_PREFIX) && firstLine.endsWith("]")) {
      const domain =
        setupSkill?.domain ??
        integrationSetups.domain(msg.workspaceId, msg.chatId);
      const attemptId = firstLine.slice(SETUP_ATTEMPT_PREFIX.length, -1);
      if (domain && attemptId) {
        const prepared = await prepareIntegrationSetup(
          msg.workspaceId,
          msg.executorCapability,
          domain,
        );
        integrationSetups.activate(msg.workspaceId, msg.chatId, {
          attemptId,
          domain,
          integrationSlug: prepared.integrationSlug,
          recipeId: prepared.recipeId,
        });
      }
    }
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
    const terminalListener = (event: AgentEvent) => {
      if (
        event.type === "result" ||
        event.type === "error" ||
        event.type === "exit"
      ) {
        session.off("event", terminalListener);
        releaseExecution?.();
        releaseExecution = undefined;
        void finishAgentActivity().catch((error: unknown) =>
          console.error("[runtime] agent activity reaction cleanup:", error),
        );
      }
    };
    releaseOnTerminal = terminalListener;
    session.on("event", terminalListener);
    const replyThreadRootId = channelReplyThreadRoot({
      isSharedChannel: Boolean(isSharedChannel),
      mentions: msg.mentions,
      messageId: msg.messageId,
      text: msg.text,
      threadRootId: msg.threadRootId,
    });
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[sendMessage] chatId=${msg.chatId} threadRootId=${
          msg.threadRootId ?? "none"
        } mentions=${JSON.stringify(msg.mentions ?? [])} shared=${
          isSharedChannel ? "y" : "n"
        } resolvedThreadRoot=${replyThreadRootId ?? "none"}`,
      );
    }
    await session.sendPrompt(
      msg.text,
      msg.messageId,
      !recordedBeforeExecution,
      {
        threadRootId: replyThreadRootId,
        mentions: msg.mentions,
        attachments,
        privateInstructions:
          [
            ...(setupSkill
              ? [`Setup skill ${setupSkill.id}:\n${setupSkill.instructions}`]
              : []),
            ...(destinationChannel && destinationChannel.visibility !== "direct"
              ? [
                  channelBridge.channelPublicationInstructions(
                    destinationChannel.id,
                    replyThreadRootId,
                  ),
                ]
              : []),
          ].join("\n\n") || undefined,
      },
    );
  } catch (error) {
    if (releaseOnTerminal) {
      session.off("event", releaseOnTerminal);
    }
    await finishAgentActivity().catch((reactionError: unknown) =>
      console.error(
        "[runtime] agent activity reaction cleanup:",
        reactionError,
      ),
    );
    releaseExecution?.();
    throw error;
  }
}
