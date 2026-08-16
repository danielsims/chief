import type { AgentEvent, ContentBlock } from "./types.js";

/** Enforces non-negotiable presentation rules at the user-facing boundary. */
export function normalizeAgentText(text: string) {
  return text.replace(/([.!?:;,])\s*—\s*/gu, "$1 ").replace(/\s*—\s*/gu, ", ");
}

export function normalizeAssistantEvent(event: AgentEvent): AgentEvent {
  if (event.type !== "message" || event.role !== "assistant") return event;
  return {
    ...event,
    content: event.content.map((block): ContentBlock =>
      block.type === "text"
        ? { ...block, text: normalizeAgentText(block.text) }
        : block,
    ),
  };
}
