import type { ChatTransport } from "ai";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useMemo } from "react";

import type {
  ChatExecutionSelection,
  ChiefUIMessage,
} from "@chief/agent-runtime/types";

import type { ChatControlState } from "./runtime-chat-controls";
import type { RuntimeTransport } from "./runtime-transport";

interface RuntimeChatTransportOptions {
  chatId: string | null;
  client: RuntimeTransport;
  cloudOrganizationId: string | null;
  executionRef: RefObject<ChatExecutionSelection | undefined>;
  executorCapability: {
    apiBaseUrl: string;
    token: string;
  } | null;
  mode: "open" | "observe";
  runtimeStatus: "connecting" | "connected" | "disconnected";
  senderName: string | undefined;
  setControls: Dispatch<SetStateAction<ChatControlState>>;
  wakeOnMentionOnly: boolean;
}

export function useRuntimeChatTransport({
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
}: RuntimeChatTransportOptions) {
  return useMemo<ChatTransport<ChiefUIMessage>>(
    () => ({
      sendMessages: ({ messages }) => {
        const message = messages.at(-1);
        const text =
          message?.parts
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
            .trim() ?? "";
        const attachments = message?.parts.flatMap((part) =>
          part.type === "file" && part.mediaType.startsWith("image/")
            ? [
                {
                  name: part.filename ?? "Image",
                  mediaType: part.mediaType,
                  url: part.url,
                },
              ]
            : [],
        );
        const isUserSubmission =
          mode === "open" &&
          Boolean(chatId) &&
          message?.role === "user" &&
          Boolean(text || attachments?.length);
        if (
          isUserSubmission &&
          (!cloudOrganizationId ||
            !executorCapability ||
            runtimeStatus !== "connected")
        ) {
          setControls((current) => ({
            ...current,
            status: "idle",
            error:
              "Chief is reconnecting to the relay. Your message was not sent.",
            errorAcknowledged: false,
          }));
        } else if (
          isUserSubmission &&
          chatId &&
          cloudOrganizationId &&
          executorCapability
        ) {
          const context = {
            threadRootId: message.metadata?.threadRootId,
            mentions: message.metadata?.mentions,
            interruptActive: message.metadata?.interruptActive,
          };
          const expectsReply =
            !wakeOnMentionOnly || Boolean(context.mentions?.length);
          setControls((current) => ({
            ...current,
            status: expectsReply && !wakeOnMentionOnly ? "running" : "idle",
            hasAgentOutput: false,
            toolProgress: {},
            error: undefined,
          }));
          client.send({
            type: "sendMessage",
            workspaceId: cloudOrganizationId,
            chatId,
            messageId: message.id,
            text,
            attachments,
            threadRootId: context.threadRootId,
            mentions: context.mentions,
            interruptActive: context.interruptActive,
            senderName: senderName?.length ? senderName : "You",
            execution: executionRef.current,
            executorCapability,
          });
        }
        return Promise.resolve(
          new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        );
      },
      reconnectToStream: () => Promise.resolve(null),
    }),
    [
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
    ],
  );
}
