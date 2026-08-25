import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";

import type {
  ChatExecutionSelection,
  ChiefUIMessage,
  InputRequest,
  MessageAttachment,
} from "@chief/agent-runtime/types";

import type { ChatControlState } from "./runtime-chat-controls";
import { useAuth } from "./auth/auth-context";
/** Durable NIP-29 events for channel timelines and message search. */
import { useChannelEvents } from "./runtime-channels";
import {
  emptyChatControls,
  reduceChatControls,
  replayChatControls,
} from "./runtime-chat-controls";
import { replayStreamingText } from "./runtime-diagnostics";
import {
  deduplicateDocumentParts,
  mergeRuntimeHistory,
  mergeRuntimeMessage,
  projectConversationMessages,
} from "./runtime-messages";
import { useRuntime } from "./runtime-provider";
import { useRuntimeChatTransport } from "./use-runtime-chat-transport";
import { useWorkspaceCapability } from "./workspace-capability";
import { buildWorkspaceContext } from "./workspace-context";
import {
  cachedTranscript,
  cacheTranscript,
} from "./workspace-conversation-cache";
import { useConversationHydration } from "./workspace-conversation-hydration";

export function useRuntimeChat(
  chatId: string | null,
  mode: "open" | "observe",
  initialExecution?: ChatExecutionSelection,
  selectedExecution?: ChatExecutionSelection,
  access?: "full" | "guarded",
  purpose?: "integration-setup" | "analytics-report",
  integrationDomain?: string,
  channelId?: string,
  agentId?: string,
  wakeOnMentionOnly = false,
  conversationSurface: "direct" | "channel" = "direct",
) {
  const { client, status: runtimeStatus } = useRuntime();
  const { events: channelEvents, loaded: channelEventsLoaded } =
    useChannelEvents(
      conversationSurface === "channel" ? (channelId ?? null) : null,
    );
  const { user } = useAuth();
  const senderName = user?.name.trim();
  const { cloudOrganizationId, capability: executorCapability } =
    useWorkspaceCapability();
  const [controls, setControls] = useState<ChatControlState>(emptyChatControls);
  const pendingStreamRef = useRef("");
  const [chatReady, setChatReady] = useState(false);
  const [execution, setExecution] = useState<
    ChatExecutionSelection | undefined
  >(undefined);
  const [sessionAgentId, setSessionAgentId] = useState<string | undefined>();
  const executionRef = useRef<ChatExecutionSelection | undefined>(
    selectedExecution ?? initialExecution,
  );
  useEffect(() => {
    executionRef.current = selectedExecution ?? initialExecution ?? execution;
  }, [execution, initialExecution, selectedExecution]);
  const transport = useRuntimeChatTransport({
    chatId,
    client,
    cloudOrganizationId,
    executionRef,
    executorCapability,
    mode,
    runtimeStatus,
    senderName,
    setControls,
    wakeOnMentionOnly,
  });
  const { messages, sendMessage, setMessages, stop } = useChat<ChiefUIMessage>({
    id: chatId ?? "inactive-chief-chat",
    generateId: () => crypto.randomUUID(),
    transport,
  });
  const initializedChatKeyRef = useRef<string | null>(null);
  const loadedHistoryKeyRef = useRef<string | null>(null);
  const [messagesChatKey, setMessagesChatKey] = useState<string | null>(null);

  useEffect(() => {
    if (
      !chatId ||
      !cloudOrganizationId ||
      !executorCapability ||
      runtimeStatus !== "connected"
    ) {
      return;
    }
    const chatKey = `${cloudOrganizationId}:${chatId}`;
    const changedChat = initializedChatKeyRef.current !== chatKey;
    if (changedChat) {
      initializedChatKeyRef.current = chatKey;
      setMessagesChatKey(chatKey);
      loadedHistoryKeyRef.current = null;
      setControls(emptyChatControls);
      pendingStreamRef.current = "";
      // Restore the last-known transcript so returning to a channel is instant
      // instead of flashing an empty frame while history reloads. The server
      // snapshot replaces/merges it moments later.
      const cached = cachedTranscript(cloudOrganizationId, chatId);
      setMessages(cached ? deduplicateDocumentParts(cached) : []);
      setChatReady(cached ? true : false);
      setExecution(undefined);
      setSessionAgentId(undefined);
    }
    let cancelled = false;
    if (mode === "observe") {
      client.send({
        type: "observeChat",
        chatId,
        workspaceId: cloudOrganizationId,
        executorCapability,
      });
    } else {
      // The brand brief rides along so the session opens already primed; the
      // org list is cached, so this resolves fast and the open stays snappy.
      void buildWorkspaceContext(cloudOrganizationId)
        .catch(() => undefined)
        .then((workspaceContext) => {
          if (cancelled) return;
          client.send({
            type: "openChat",
            chatId,
            workspaceContext,
            workspaceId: cloudOrganizationId,
            execution: executionRef.current,
            access,
            purpose,
            integrationDomain,
            channelId,
            agentId,
            conversationSurface,
            executorCapability,
          });
        });
    }

    const unsub = client.subscribe((msg) => {
      if (msg.type === "error" && msg.chatId === chatId) {
        setControls((current) => ({
          ...current,
          error: { message: msg.message },
          errorAcknowledged: false,
          status: "idle",
        }));
        return;
      }
      if (
        msg.type === "chatOpened" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.chatId === chatId
      ) {
        setExecution(msg.execution);
        setSessionAgentId(msg.agentId);
        return;
      }
      if (
        msg.type === "history" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.chatId === chatId
      ) {
        pendingStreamRef.current = replayStreamingText(msg.events);
        const incoming = deduplicateDocumentParts(msg.messages);
        cacheTranscript(cloudOrganizationId, chatId, incoming);
        if (loadedHistoryKeyRef.current === chatKey) {
          setMessages((current) => mergeRuntimeHistory(current, incoming));
        } else {
          loadedHistoryKeyRef.current = chatKey;
          setMessages(incoming);
        }
        setControls(replayChatControls(msg.events, msg.running));
        setChatReady(true);
        return;
      }
      if (
        msg.type === "message" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.chatId === chatId
      ) {
        if (import.meta.env.DEV) {
          const text = msg.message.parts
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join(" ")
            .slice(0, 80);
          const toolNames = msg.message.parts
            .filter(
              (
                part,
              ): part is Extract<
                ChiefUIMessage["parts"][number],
                { type: "dynamic-tool" }
              > => part.type === "dynamic-tool",
            )
            .map((part) => part.toolName);
          console.log(
            "[chief-msg-in]",
            JSON.stringify({
              id: msg.message.id,
              role: msg.message.role,
              threadRootId: msg.message.metadata?.threadRootId ?? null,
              text,
              toolNames,
              parts: msg.message.parts.length,
            }),
          );
        }
        const hasAssistantText =
          msg.message.role === "assistant" &&
          msg.message.parts.some(
            (part) => part.type === "text" && part.text.trim().length > 0,
          );
        const bufferedText = pendingStreamRef.current;
        if (hasAssistantText && bufferedText) {
          pendingStreamRef.current = "";
          const completed = mergeRuntimeMessage(
            [
              {
                id: `stream:${chatId}`,
                role: "assistant",
                metadata: { createdAt: Date.now() },
                parts: [
                  { type: "text", text: bufferedText, state: "streaming" },
                ],
              },
            ],
            msg.message,
          );
          setMessages((current) =>
            completed.reduce(
              (next, message) => mergeRuntimeMessage(next, message),
              current,
            ),
          );
        } else {
          setMessages((current) => mergeRuntimeMessage(current, msg.message));
        }
        return;
      }
      if (msg.type !== "event" || msg.chatId !== chatId) return;
      if (msg.event.type === "stream") {
        pendingStreamRef.current += msg.event.text;
      }
      if (msg.event.type === "result" && pendingStreamRef.current.trim()) {
        const completedText = pendingStreamRef.current;
        pendingStreamRef.current = "";
        setMessages((current) => [
          ...current,
          {
            id: `stream:${chatId}`,
            role: "assistant",
            metadata: { createdAt: Date.now() },
            parts: [{ type: "text", text: completedText, state: "streaming" }],
          },
        ]);
      }
      setControls((current) => reduceChatControls(current, msg.event));
    });
    return () => {
      cancelled = true;
      // Navigating away unloads the chat. Reset the history marker so the
      // next open of the SAME chat replaces (not merges) the transcript — the
      // server history is authoritative and merging it into the stale live
      // buffer re-inserted every thread message into the timeline.
      initializedChatKeyRef.current = null;
      loadedHistoryKeyRef.current = null;
      client.send({
        type: "closeChat",
        workspaceId: cloudOrganizationId,
        chatId,
        executorCapability,
      });
      unsub();
    };
  }, [
    chatId,
    setMessages,
    client,
    runtimeStatus,
    cloudOrganizationId,
    executorCapability,
    mode,
    access,
    purpose,
    integrationDomain,
    channelId,
    agentId,
    conversationSurface,
  ]);

  const interrupt = () => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "interruptChat",
        workspaceId: cloudOrganizationId,
        chatId,
        executorCapability,
      });
    }
  };

  const respondPermission = (requestId: string, behavior: "allow" | "deny") => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "respondPermission",
        workspaceId: cloudOrganizationId,
        chatId,
        requestId,
        behavior,
        executorCapability,
      });
    }
  };

  const respondQuestion = (
    requestId: string,
    answers: Record<string, string> | null,
  ) => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "respondQuestion",
        workspaceId: cloudOrganizationId,
        chatId,
        requestId,
        answers,
        executorCapability,
      });
    }
  };

  const provideInput = (
    request: InputRequest,
    values: Record<string, string>,
  ) => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "provideInput",
        workspaceId: cloudOrganizationId,
        chatId,
        request,
        values,
        executorCapability,
      });
    }
  };

  const sendMessageWithContext = useCallback(
    (
      text: string,
      context?: {
        threadRootId?: string;
        mentions?: string[];
        interruptActive?: boolean;
      },
      attachments?: MessageAttachment[],
    ) => {
      void sendMessage({
        text,
        metadata: {
          createdAt: Date.now(),
          ...(context?.threadRootId
            ? { threadRootId: context.threadRootId }
            : undefined),
          ...(context?.mentions?.length
            ? { mentions: context.mentions }
            : undefined),
          ...(context?.interruptActive ? { interruptActive: true } : undefined),
        },
        files: attachments?.map((attachment) => ({
          type: "file" as const,
          filename: attachment.name,
          mediaType: attachment.mediaType,
          url: attachment.url,
        })),
      });
    },
    [sendMessage],
  );

  const visibleMessages = useMemo(() => {
    const activeChatKey =
      cloudOrganizationId && chatId ? `${cloudOrganizationId}:${chatId}` : null;
    const scopedMessages =
      activeChatKey && messagesChatKey === activeChatKey
        ? messages
        : cloudOrganizationId && chatId
          ? (cachedTranscript(cloudOrganizationId, chatId) ?? [])
          : [];
    // A provider restart replays the session's history through the driver, and
    // each replayed message is emitted as a fresh transcript message (new id,
    // same toolCallId/text, no threadRootId). Those copies would render the
    // thread's tool/browser UI in the main timeline. Direct-message relay IDs
    // are routing metadata, so their private authored text remains visible.
    return projectConversationMessages(
      scopedMessages,
      channelEvents,
      conversationSurface,
    );
  }, [
    channelEvents,
    chatId,
    cloudOrganizationId,
    conversationSurface,
    messages,
    messagesChatKey,
  ]);

  const activeChatKey =
    cloudOrganizationId && chatId ? `${cloudOrganizationId}:${chatId}` : null;
  const activeChatReady =
    Boolean(activeChatKey) &&
    (messagesChatKey === activeChatKey
      ? chatReady
      : Boolean(
          cloudOrganizationId &&
          chatId &&
          cachedTranscript(cloudOrganizationId, chatId),
        ));
  const currentConversationResolved =
    activeChatReady &&
    (conversationSurface === "direct" || channelEventsLoaded);
  const conversationResolved = useConversationHydration({
    channelId,
    chatId,
    currentlyResolved: currentConversationResolved,
    surface: conversationSurface,
    workspaceId: cloudOrganizationId,
  });
  const dismissError = useCallback(() => {
    setControls((current) => {
      if (!current.error) return current;
      return { ...current, errorAcknowledged: true };
    });
  }, []);

  return {
    messages: visibleMessages,
    controls,
    dismissError,
    sendMessage,
    sendMessageWithContext,
    interrupt,
    stop,
    respondPermission,
    respondQuestion,
    provideInput,
    chatReady: activeChatReady || conversationResolved,
    // The first visit waits for both transcript and channel events. Once that
    // conversation has hydrated, revisits render its cached timeline
    // immediately while both sources revalidate invisibly.
    channelResolved: conversationResolved,
    execution,
    sessionAgentId,
  };
}

/**
 * Opens the low-level runtime connection for one interactive Chief
 * conversation. UI-specific draft, timeline, and presentation state belongs to
 * the composed chat hooks rather than this transport-facing hook.
 */
