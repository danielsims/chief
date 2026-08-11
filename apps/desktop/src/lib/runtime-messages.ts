import type { ChannelEvent, ChiefUIMessage } from "@chief/agent-runtime/types";

import { channelActionFromEvent } from "./channel-actions";
import {
  channelEventSourceId,
  channelEventThreadRootId,
} from "./channel-read-state";

const HIDDEN_RUNTIME_ERRORS = new Set(["turn interrupted", "turn cancelled"]);

/**
 * Infrastructure failures that belong in logs, not in a shared chat: a driver
 * process that exited, a service that failed to start, an agent runtime that
 * went away. They are not user content and must not render in a channel or DM.
 */
const HIDDEN_RUNTIME_ERROR_PATTERNS = [
  /^open ?code /i,
  /service failure/i,
  /^agent process exited/i,
];

/** Intentional cancellation and internal runtime failures are not chat content. */
export function visibleRuntimeError(error?: string) {
  if (!error) return undefined;
  const trimmed = error.trim();
  if (HIDDEN_RUNTIME_ERRORS.has(trimmed.toLocaleLowerCase())) return undefined;
  if (HIDDEN_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return undefined;
  }
  return error;
}

function textContent(message: ChiefUIMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

function settledParts(message: ChiefUIMessage) {
  return message.parts.map((part) => {
    if (part.type !== "text") return part;
    const { state: _state, ...settled } = part;
    return settled;
  });
}

function withText(message: ChiefUIMessage, text: string): ChiefUIMessage {
  let replaced = false;
  const parts: ChiefUIMessage["parts"] = [];
  for (const part of message.parts) {
    if (part.type !== "text") {
      parts.push(part);
      continue;
    }
    if (replaced) continue;
    replaced = true;
    const { state: _state, ...settled } = part;
    parts.push({ ...settled, text });
  }
  return {
    ...message,
    parts: replaced ? parts : [{ type: "text", text }, ...parts],
  };
}

export function mergeRuntimeMessage(
  current: ChiefUIMessage[],
  persisted: ChiefUIMessage,
) {
  const existing = current.findIndex((message) => message.id === persisted.id);
  if (existing >= 0) {
    return deduplicateDocumentParts(
      current.map((message, index) =>
        index === existing ? persisted : message,
      ),
    );
  }
  const streamingIndex = current.findIndex(
    (message) =>
      message.role === "assistant" && message.id.startsWith("stream:"),
  );
  if (persisted.role === "assistant" && streamingIndex >= 0) {
    const streaming = current[streamingIndex];
    if (!streaming) return deduplicateDocumentParts([...current, persisted]);
    const streamedText = textContent(streaming);
    const persistedText = textContent(persisted);

    // Tool-only durable messages are a new boundary. Keep the commentary that
    // streamed immediately before the tool instead of replacing it.
    if (streamedText.trim() && !persistedText.trim()) {
      const completedStream: ChiefUIMessage = {
        ...streaming,
        id: `${streaming.id}:before:${persisted.id}`,
        parts: settledParts(streaming),
      };
      return deduplicateDocumentParts([
        ...current.slice(0, streamingIndex),
        completedStream,
        persisted,
        ...current.slice(streamingIndex + 1),
      ]);
    }

    // Codex can persist a shorter prefix after the complete response has
    // already streamed. Preserve the fuller response while adopting the
    // durable message ID and its non-text parts.
    const next =
      streamedText.length > persistedText.length &&
      streamedText.startsWith(persistedText)
        ? withText(persisted, streamedText)
        : persisted;
    return deduplicateDocumentParts(
      current.map((message, index) =>
        index === streamingIndex ? next : message,
      ),
    );
  }
  return deduplicateDocumentParts([...current, persisted]);
}

/** Reconcile a reconnect snapshot without dropping newer optimistic/live turns. */
export function mergeRuntimeHistory(
  current: ChiefUIMessage[],
  incoming: ChiefUIMessage[],
) {
  return incoming.reduce(
    (next, message) => mergeRuntimeMessage(next, message),
    current,
  );
}

export function deduplicateDocumentParts(messages: ChiefUIMessage[]) {
  const threadedFileIds = new Set(
    messages.flatMap((message) =>
      message.metadata?.threadRootId
        ? message.parts.flatMap((part) =>
            part.type === "data-document" ? [part.data.fileId] : [],
          )
        : [],
    ),
  );
  const seen = new Set<string>();
  return [...messages]
    .reverse()
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => {
        if (part.type !== "data-document") return true;
        if (
          !message.metadata?.threadRootId &&
          threadedFileIds.has(part.data.fileId)
        ) {
          return false;
        }
        if (seen.has(part.data.fileId)) return false;
        seen.add(part.data.fileId);
        return true;
      }),
    }))
    .reverse();
}

/**
 * Shared channels publish text through durable channel events. Until an event
 * exists, retain only runtime activity so model narration cannot accidentally
 * become a public chat message.
 */
export function channelActivityOnlyMessage(
  message: ChiefUIMessage,
): ChiefUIMessage | undefined {
  if (message.role !== "assistant") return message;
  const parts = message.parts.filter((part) => part.type !== "text");
  return parts.length > 0 ? { ...message, parts } : undefined;
}

/**
 * Builds one channel timeline from durable published events plus unpublished
 * runtime activity. Channel events own visible text and thread placement.
 */
export function projectChannelTimeline(
  messages: ChiefUIMessage[],
  events: ChannelEvent[],
) {
  if (events.length === 0) {
    return dropReplayedMessages(
      messages.flatMap((message) => {
        const visible = channelActivityOnlyMessage(message);
        return visible ? [visible] : [];
      }),
    );
  }

  const sourceIdsByEventId = new Map(
    events.flatMap((event) => {
      const sourceId = channelEventSourceId(event);
      return sourceId ? [[event.id, sourceId] as const] : [];
    }),
  );
  const directById = new Map(messages.map((message) => [message.id, message]));
  const seenIds = new Set<string>();
  const canonical: ChiefUIMessage[] = [];

  for (const event of events) {
    if (event.kind !== 9 || !event.content.trim()) continue;
    const id = channelEventSourceId(event) ?? event.id;
    if (id.endsWith("-welcome") || seenIds.has(id)) continue;
    const direct = directById.get(id);
    const channelAction = channelActionFromEvent(event);
    const agentId = event.actor.type === "agent" ? event.actor.id : undefined;
    const protocolRootId = channelEventThreadRootId(event);
    const threadRootId = protocolRootId
      ? (sourceIdsByEventId.get(protocolRootId) ?? protocolRootId)
      : direct?.metadata?.threadRootId;
    const needsEnrichment =
      !direct ||
      Boolean(threadRootId && threadRootId !== direct.metadata?.threadRootId) ||
      Boolean(channelAction && !direct.metadata?.channelAction) ||
      Boolean(agentId && agentId !== direct.metadata?.agentId) ||
      Boolean(direct.metadata && !direct.metadata.createdAt);
    canonical.push(
      !needsEnrichment
        ? direct
        : direct
          ? {
              ...direct,
              metadata: {
                ...direct.metadata,
                createdAt: direct.metadata?.createdAt ?? event.createdAt,
                ...(agentId ? { agentId } : {}),
                ...(threadRootId ? { threadRootId } : {}),
                ...(channelAction ? { channelAction } : {}),
              },
            }
          : {
              id,
              role: event.actor.type === "user" ? "user" : "assistant",
              parts: [{ type: "text", text: event.content }],
              metadata: {
                createdAt: event.createdAt,
                ...(agentId ? { agentId } : {}),
                ...(threadRootId ? { threadRootId } : {}),
                ...(channelAction ? { channelAction } : {}),
              },
            },
    );
    seenIds.add(id);
  }

  for (const message of messages) {
    if (seenIds.has(message.id)) continue;
    const visible = channelActivityOnlyMessage(message);
    if (visible) canonical.push(visible);
  }
  return dropReplayedMessages(
    canonical.sort(
      (left, right) =>
        (left.metadata?.createdAt ?? 0) - (right.metadata?.createdAt ?? 0),
    ),
  );
}

/**
 * Drop transcript copies produced by a provider-restart replay.
 *
 * When a driver reconnects it replays the session's history, and each replayed
 * message is emitted as a fresh message: a new message id, the SAME toolCallId
 * and text, and — because the replay runs outside any thread context — no
 * threadRootId. Those copies render the thread's tool/browser UI in the main
 * timeline as if it were main-chat content. A threadless message whose tool
 * calls and text all already appear earlier in the list is such a replay; the
 * original thread-attached message is the one that should render.
 *
 * The converse matters too: a brand-new live message (an optimistic user send,
 * a streaming assistant reply) has no channel event yet and must stay visible
 * until its mirror lands — it is never a replay because its content is new.
 */
export function dropReplayedMessages(
  messages: ChiefUIMessage[],
): ChiefUIMessage[] {
  const keptToolCallIds = new Set<string>();
  const keptTextSignatures = new Set<string>();
  const result: ChiefUIMessage[] = [];
  for (const message of messages) {
    const toolParts = message.parts.filter(
      (
        part,
      ): part is Extract<
        ChiefUIMessage["parts"][number],
        { type: "dynamic-tool" }
      > => part.type === "dynamic-tool",
    );
    const text = message.parts
      .filter(
        (
          part,
        ): part is Extract<ChiefUIMessage["parts"][number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    // A replay is a threadless copy of a message that already exists with its
    // thread context; match by role+text regardless of the earlier copy's root.
    // Thread-attached messages are never treated as replays.
    const signature = `${message.role}\0${text}`;
    const toolReplay =
      toolParts.length > 0 &&
      !message.metadata?.threadRootId &&
      toolParts.every((part) => keptToolCallIds.has(part.toolCallId));
    const textReplay =
      text.length > 0 &&
      !message.metadata?.threadRootId &&
      keptTextSignatures.has(signature);
    if (toolReplay || textReplay) continue;
    result.push(message);
    for (const part of toolParts) keptToolCallIds.add(part.toolCallId);
    if (text) keptTextSignatures.add(signature);
  }
  return result;
}

/** @deprecated Use {@link dropReplayedMessages} — it also covers text. */
export function dropReplayedToolMessages(
  messages: ChiefUIMessage[],
): ChiefUIMessage[] {
  return dropReplayedMessages(messages);
}
