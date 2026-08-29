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
  private usedAnyTool = false;
  private publishedThroughChannelTool = false;

  observe(event: AgentEvent) {
    if (event.type !== "message" || event.role !== "assistant") return;
    this.usedAnyTool ||= event.content.some(
      (block) => block.type === "tool_use",
    );
    this.publishedThroughChannelTool ||= event.content.some(
      (block) =>
        block.type === "tool_use" &&
        /channelsMessages(?:Post|Replies)/iu.test(block.name),
    );
    const text = event.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (text) {
      this.candidate = {
        ...event,
        role: "assistant",
        content: [{ type: "text", text }],
      } satisfies AssistantMessage;
    }
  }

  completed(event: AgentEvent): AssistantMessage | undefined {
    if (this.publishedThroughChannelTool) return undefined;
    if (event.type === "error" || event.type === "exit") {
      return this.candidate;
    }
    if (event.type === "result" && (!event.ok || !this.usedAnyTool)) {
      return this.candidate;
    }
    return undefined;
  }
}
