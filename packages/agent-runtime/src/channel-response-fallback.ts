import type { AgentEvent } from "./types.js";

type AssistantMessage = Extract<AgentEvent, { type: "message" }> & {
  role: "assistant";
};

/**
 * Preserve the explicit channel-publication boundary for working turns while
 * ensuring a simple addressed reply cannot disappear when a provider returns
 * ordinary text instead of calling the channel post tool.
 */
export class AddressedChannelReplyFallback {
  private candidate: AssistantMessage | undefined;
  private usedToolsOrRichOutput = false;

  observe(event: AgentEvent) {
    if (event.type === "toolProgress") {
      this.usedToolsOrRichOutput = true;
      return;
    }
    if (event.type !== "message" || event.role !== "assistant") return;
    if (event.content.some((block) => block.type !== "text")) {
      this.usedToolsOrRichOutput = true;
    }
    const text = event.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (text) this.candidate = event as AssistantMessage;
  }

  completed(event: AgentEvent): AssistantMessage | undefined {
    if (event.type !== "result" || !event.ok || this.usedToolsOrRichOutput) {
      return undefined;
    }
    return this.candidate;
  }
}
