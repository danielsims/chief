import type { ContentBlock } from "@chief/agent-runtime/types";

export interface ConversationActivityMessage {
  id: string;
  role: "assistant" | "user";
  createdAt?: number;
  agentId?: string;
  /** The thread this message belongs to, when it is a thread reply. */
  threadRootId?: string;
  blocks: ContentBlock[];
}

export interface ConversationActivityTurn {
  id: string;
  startedAt?: number;
  updatedAt?: number;
  agentId?: string;
  /** The thread this work happened in, when it happened in one. */
  threadRootId?: string;
  prompt: string;
  blocks: ContentBlock[];
  /** When each tool call last changed, keyed by tool use id. */
  toolTimes: Map<string, number>;
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

interface ActivityThread {
  prompt?: ConversationActivityMessage;
  groups: Map<string, ConversationActivityTurn>;
  lastAgentId?: string;
}

/**
 * Groups durable tool calls by the user turn that triggered them. Work in a
 * thread is attributed to the latest prompt in that same thread, so runs in
 * several threads at once never borrow one another's prompt.
 */
export function conversationActivityTurns(
  messages: readonly ConversationActivityMessage[],
): ConversationActivityTurn[] {
  const turns: ConversationActivityTurn[] = [];
  const threads = new Map<string, ActivityThread>();
  const toolAgents = new Map<string, string>();
  const threadFor = (key: string) => {
    let thread = threads.get(key);
    if (!thread) {
      thread = { groups: new Map() };
      threads.set(key, thread);
    }
    return thread;
  };
  for (const message of messages) {
    if (message.role === "user") {
      // A top-level message opens its own thread; replies join theirs.
      const threadRootId = message.threadRootId ?? message.id;
      const thread: ActivityThread = { prompt: message, groups: new Map() };
      threads.set(threadRootId, thread);
      // Unthreaded agent output follows the latest top-level prompt.
      if (!message.threadRootId) threads.set("", thread);
      // Surface the sent message immediately, before the agent has produced any
      // activity, so the turn it started is visible while it works.
      if (message.agentId) {
        const turn: ConversationActivityTurn = {
          id: message.id,
          agentId: message.agentId,
          threadRootId,
          startedAt: message.createdAt,
          prompt: visiblePrompt(message.blocks),
          blocks: [],
          toolTimes: new Map(),
        };
        thread.groups.set(message.agentId, turn);
        turns.push(turn);
      }
      continue;
    }
    const blocks = activityBlocks(message.blocks);
    if (!blocks.length) continue;
    const thread = threadFor(message.threadRootId ?? "");
    const result = blocks.find((block) => block.type === "tool_result");
    const agentId =
      message.agentId ??
      (result?.type === "tool_result"
        ? toolAgents.get(result.tool_use_id)
        : undefined) ??
      thread.lastAgentId;
    thread.lastAgentId = agentId;
    for (const block of blocks)
      if (block.type === "tool_use" && agentId)
        toolAgents.set(block.id, agentId);
    const key = agentId ?? "unknown";
    let turn = thread.groups.get(key);
    if (!turn) {
      const prompt = thread.prompt;
      const sourceId = prompt?.id ?? `assistant:${message.id}`;
      const threadRootId =
        message.threadRootId ?? prompt?.threadRootId ?? prompt?.id;
      turn = {
        id: agentId ? `${sourceId}:${agentId}` : sourceId,
        agentId,
        ...(threadRootId ? { threadRootId } : undefined),
        startedAt: message.createdAt ?? prompt?.createdAt,
        prompt: prompt ? visiblePrompt(prompt.blocks) : "Agent-initiated work",
        blocks: [],
        toolTimes: new Map(),
      };
      thread.groups.set(key, turn);
      turns.push(turn);
    }
    turn.updatedAt = message.createdAt ?? turn.updatedAt;
    turn.blocks.push(...blocks);
    if (message.createdAt === undefined) continue;
    for (const block of blocks) {
      if (block.type === "tool_use")
        turn.toolTimes.set(block.id, message.createdAt);
      if (block.type === "tool_result")
        turn.toolTimes.set(block.tool_use_id, message.createdAt);
    }
  }
  return turns;
}
