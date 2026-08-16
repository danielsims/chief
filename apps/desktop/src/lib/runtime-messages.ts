import type {
  AgentPluginSummary,
  ChannelEvent,
  ChiefUIMessage,
} from "@chief/agent-runtime/types";

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

function isPluginSummary(value: unknown): value is AgentPluginSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plugin = value as Partial<AgentPluginSummary>;
  return Boolean(
    typeof plugin.id === "string" &&
    typeof plugin.name === "string" &&
    typeof plugin.description === "string" &&
    typeof plugin.category === "string" &&
    typeof plugin.status === "string" &&
    typeof plugin.enabled === "boolean" &&
    typeof plugin.trusted === "boolean" &&
    plugin.source &&
    typeof plugin.source === "object",
  );
}

function channelEventParts(event: ChannelEvent): ChiefUIMessage["parts"] {
  if (event.kind !== 9 || !Array.isArray(event.parts)) return [];
  return event.parts.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const candidate = part as {
      type?: unknown;
      data?: { plugins?: unknown };
    };
    if (
      candidate.type !== "data-plugin-recommendations" ||
      !Array.isArray(candidate.data?.plugins)
    ) {
      return [];
    }
    const plugins = candidate.data.plugins.filter(isPluginSummary).slice(0, 8);
    return plugins.length > 0
      ? [{ type: "data-plugin-recommendations", data: { plugins } } as const]
      : [];
  });
}

function withChannelEventParts(
  message: ChiefUIMessage,
  parts: ChiefUIMessage["parts"],
) {
  if (parts.length === 0) return message;
  const eventTypes = new Set(parts.map((part) => part.type));
  return {
    ...message,
    parts: [
      ...message.parts.filter((part) => !eventTypes.has(part.type)),
      ...parts,
    ],
  };
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
    if (event.kind !== 9) continue;
    const eventParts = channelEventParts(event);
    if (!event.content.trim() && eventParts.length === 0) continue;
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
      eventParts.length > 0 ||
      direct.metadata?.createdAt !== event.createdAt;
    canonical.push(
      !needsEnrichment
        ? direct
        : direct
          ? withChannelEventParts(
              {
                ...direct,
                metadata: {
                  ...direct.metadata,
                  // Publication is the moment a private runtime message becomes
                  // visible in the channel. A delayed schedule must not sort a
                  // newly published message back at its planned run time.
                  createdAt: event.createdAt,
                  ...(agentId ? { agentId } : {}),
                  ...(threadRootId ? { threadRootId } : {}),
                  ...(channelAction ? { channelAction } : {}),
                },
              },
              eventParts,
            )
          : {
              id,
              role: event.actor.type === "user" ? "user" : "assistant",
              parts: [
                ...(event.content.trim()
                  ? [{ type: "text" as const, text: event.content }]
                  : []),
                ...eventParts,
              ],
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

  const runtimeActivity = dropReplayedMessages(
    messages.flatMap((message) => {
      if (seenIds.has(message.id)) return [];
      const visible = channelActivityOnlyMessage(message);
      return visible ? [visible] : [];
    }),
  );
  return [...canonical, ...runtimeActivity].sort(
    (left, right) =>
      (left.metadata?.createdAt ?? 0) - (right.metadata?.createdAt ?? 0),
  );
}

/**
 * Project one runtime transcript for its user-facing surface. Direct messages
 * may still carry a relay channel id for routing, but their authored assistant
 * text is private transcript content and must not wait for channel publication.
 */
export function projectConversationMessages(
  messages: ChiefUIMessage[],
  events: ChannelEvent[],
  surface: "direct" | "channel",
) {
  return surface === "channel"
    ? projectChannelTimeline(messages, events)
    : projectDirectConversation(messages, events);
}

function projectDirectConversation(
  messages: ChiefUIMessage[],
  events: ChannelEvent[],
) {
  const publishedParts = events.flatMap((event) => {
    const parts = channelEventParts(event);
    if (event.kind !== 9 || parts.length === 0) return [];
    const id = channelEventSourceId(event) ?? event.id;
    const threadRootId = channelEventThreadRootId(event) ?? undefined;
    return [
      {
        id,
        role: event.actor.type === "user" ? "user" : "assistant",
        parts: [
          ...(event.content.trim()
            ? [{ type: "text" as const, text: event.content }]
            : []),
          ...parts,
        ],
        metadata: {
          createdAt: event.createdAt,
          ...(event.actor.type === "agent" ? { agentId: event.actor.id } : {}),
          ...(threadRootId ? { threadRootId } : {}),
        },
      } satisfies ChiefUIMessage,
    ];
  });
  return dropReplayedMessages(mergeRuntimeHistory(messages, publishedParts));
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
