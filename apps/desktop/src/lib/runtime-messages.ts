import type { ChiefUIMessage } from "@chief/agent-runtime/types";

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
