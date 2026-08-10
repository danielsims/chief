import type { ContentBlock } from "@chief/agent-runtime/types";

export interface ConversationActivityMessage {
  id: string;
  role: "assistant" | "user";
  createdAt?: number;
  blocks: ContentBlock[];
}

export interface ConversationActivityTurn {
  id: string;
  startedAt?: number;
  prompt: string;
  blocks: ContentBlock[];
}

function activityBlocks(blocks: readonly ContentBlock[]) {
  return blocks.filter(
    (block) => block.type === "tool_use" || block.type === "tool_result",
  );
}

function visiblePrompt(blocks: readonly ContentBlock[]) {
  return blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("[chief-") &&
        !line.startsWith("<chief_") &&
        !line.startsWith("CHIEF_"),
    )
    .join(" ");
}

/** Groups durable tool calls by the user turn that triggered them. */
export function conversationActivityTurns(
  messages: readonly ConversationActivityMessage[],
): ConversationActivityTurn[] {
  const turns: ConversationActivityTurn[] = [];
  let current: ConversationActivityTurn | null = null;

  const finishCurrent = () => {
    if (current) turns.push(current);
  };

  for (const message of messages) {
    if (message.role === "user") {
      finishCurrent();
      current = {
        id: message.id,
        startedAt: message.createdAt,
        prompt: visiblePrompt(message.blocks),
        blocks: [],
      };
      continue;
    }

    const tools = activityBlocks(message.blocks);
    if (tools.length === 0) continue;
    current ??= {
      id: `assistant:${message.id}`,
      startedAt: message.createdAt,
      prompt: "Agent-initiated work",
      blocks: [],
    };
    current.blocks.push(...tools);
  }

  finishCurrent();
  return turns;
}
