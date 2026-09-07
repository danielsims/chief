import type { ContentBlock } from "@chief/agent-runtime/types";

export interface ConversationActivityMessage {
  id: string;
  role: "assistant" | "user";
  createdAt?: number;
  agentId?: string;
  blocks: ContentBlock[];
}

export interface ConversationActivityTurn {
  id: string;
  startedAt?: number;
  updatedAt?: number;
  agentId?: string;
  prompt: string;
  blocks: ContentBlock[];
}

function activityBlocks(blocks: readonly ContentBlock[]) {
  return blocks.filter(
    (block) =>
      block.type === "thinking" ||
      block.type === "tool_use" ||
      block.type === "tool_result",
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
  let prompt: ConversationActivityMessage | undefined;
  let groups = new Map<string, ConversationActivityTurn>();
  const toolAgents = new Map<string, string>();
  let lastAgentId: string | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      prompt = message;
      groups = new Map();
      lastAgentId = undefined;
      continue;
    }
    const blocks = activityBlocks(message.blocks);
    if (!blocks.length) continue;
    const result = blocks.find((block) => block.type === "tool_result");
    const agentId =
      message.agentId ??
      (result?.type === "tool_result"
        ? toolAgents.get(result.tool_use_id)
        : undefined) ??
      lastAgentId;
    lastAgentId = agentId;
    for (const block of blocks)
      if (block.type === "tool_use" && agentId)
        toolAgents.set(block.id, agentId);
    const key = agentId ?? "unknown";
    let turn = groups.get(key);
    if (!turn) {
      const sourceId = prompt?.id ?? `assistant:${message.id}`;
      turn = {
        id: agentId ? `${sourceId}:${agentId}` : sourceId,
        agentId,
        startedAt: message.createdAt ?? prompt?.createdAt,
        prompt: prompt ? visiblePrompt(prompt.blocks) : "Agent-initiated work",
        blocks: [],
      };
      groups.set(key, turn);
      turns.push(turn);
    }
    turn.updatedAt = message.createdAt ?? turn.updatedAt;
    turn.blocks.push(...blocks);
  }
  return turns;
}
