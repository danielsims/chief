import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import { withoutMarkerLines } from "../../lib/integration-setup";
import { messageBlocks } from "../../lib/runtime";
import { toolPresentation } from "./message-blocks";

export function channelActivityState(
  messages: ChiefUIMessage[],
  hasAgentOutput: boolean,
  agentLabel = "Chief",
) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const assistantMessages = messages
    .slice(lastUserIndex + 1)
    .filter((message) => message.role === "assistant");
  const blocks = assistantMessages.flatMap((message) =>
    withoutMarkerLines(messageBlocks(message)),
  );
  const results = new Set(
    blocks.flatMap((block) =>
      block.type === "tool_result" ? [block.tool_use_id] : [],
    ),
  );
  const activeTool = [...blocks]
    .reverse()
    .find((block) => block.type === "tool_use" && !results.has(block.id));
  const finalTextMessageId = [...assistantMessages]
    .reverse()
    .find((message) =>
      message.parts.some(
        (part) => part.type === "text" && part.text.trim().length > 0,
      ),
    )?.id;

  return {
    blocks,
    messageIds: new Set(assistantMessages.map((message) => message.id)),
    finalTextMessageId,
    statusLabel:
      activeTool?.type === "tool_use"
        ? `${agentLabel}: ${toolPresentation(activeTool.name, activeTool.input)}`
        : hasAgentOutput
          ? `${agentLabel} is typing…`
          : `${agentLabel} is getting started…`,
  };
}
