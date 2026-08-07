import type { ChiefUIMessage } from "@chief/agent-runtime/types";

const HIDDEN_RUNTIME_ERRORS = new Set(["turn interrupted", "turn cancelled"]);

/** Intentional cancellation is interaction state, not chat content. */
export function visibleRuntimeError(error?: string) {
  if (!error) return undefined;
  return HIDDEN_RUNTIME_ERRORS.has(error.trim().toLocaleLowerCase())
    ? undefined
    : error;
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
  const seen = new Set<string>();
  return [...messages]
    .reverse()
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => {
        if (part.type !== "data-document") return true;
        if (seen.has(part.data.fileId)) return false;
        seen.add(part.data.fileId);
        return true;
      }),
    }))
    .reverse();
}

/**
 * Drop transcript copies produced by a provider-restart replay.
 *
 * When a driver reconnects it replays the session's history, and each replayed
 * tool call is emitted as a fresh message: a new message id, the SAME
 * toolCallId, and — because the replay runs outside any thread context — no
 * threadRootId. Those copies render the thread's tool/browser UI in the main
 * timeline as if it were main-chat content. A threadless message whose tool
 * calls all already appear earlier in the list is such a replay; the original
 * thread-attached message is the one that should render.
 */
export function dropReplayedToolMessages(
  messages: ChiefUIMessage[],
): ChiefUIMessage[] {
  const keptToolCallIds = new Set<string>();
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
    const isReplay =
      toolParts.length > 0 &&
      !message.metadata?.threadRootId &&
      toolParts.every((part) => keptToolCallIds.has(part.toolCallId));
    if (isReplay) continue;
    result.push(message);
    for (const part of toolParts) keptToolCallIds.add(part.toolCallId);
  }
  return result;
}
