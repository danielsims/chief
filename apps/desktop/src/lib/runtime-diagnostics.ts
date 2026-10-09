import type {
  AgentEvent,
  ChiefUIMessage,
  ContentBlock,
} from "@chief/agent-runtime/types";
import { parseJsonValue } from "@chief/relay-contracts";

export {
  useAgentPreferences,
  useWorkspaceFile,
  useWorkspaceFiles,
} from "./runtime-files";
export { useWorkspaceEnvironmentVariables } from "./runtime-settings";

export type { ChatControlState } from "./runtime-chat-controls";

export function messageBlocks(message: ChiefUIMessage): ContentBlock[] {
  return message.parts.flatMap((part): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "file" && part.mediaType.startsWith("image/")) {
      return [
        {
          type: "image",
          name: part.filename ?? "Image",
          mediaType: part.mediaType,
          url: part.url,
        },
      ];
    }
    if (part.type === "reasoning") {
      return [{ type: "thinking", thinking: part.text }];
    }
    if (part.type === "dynamic-tool") {
      const use: ContentBlock = {
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: parseJsonValue(part.input),
      };
      if (part.state === "output-available") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: parseJsonValue(part.output) ?? null,
          },
        ];
      }
      if (part.state === "output-error") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.errorText,
            is_error: true,
          },
        ];
      }
      return [use];
    }
    if (
      part.type === "data-chart" ||
      part.type === "data-table" ||
      part.type === "data-document" ||
      part.type === "data-plugin-recommendations" ||
      part.type === "data-project-recommendation" ||
      part.type === "data-question"
    ) {
      return [part];
    }
    return [];
  });
}

export function replayStreamingText(events: AgentEvent[]) {
  let text = "";
  for (const event of events) {
    if (event.type === "stream") text += event.text;
    if (
      event.type === "message" ||
      event.type === "result" ||
      event.type === "error" ||
      event.type === "exit"
    ) {
      text = "";
    }
  }
  return text;
}
