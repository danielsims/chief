import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

interface SpecialistTask {
  id: string;
  agent: string;
  parentId?: string;
  status?: string;
  triggerContext?: { threadRootId?: string };
  triggerId?: string;
}

interface ToolBlock {
  type: string;
  input?: unknown;
}

interface TranscriptMessage<TBlock extends ToolBlock> {
  id: string;
  role: string;
  blocks: readonly TBlock[];
}

/** Render task cards only in the conversation that owns their execution. */
export function specialistTaskBelongsToConversation(
  task: SpecialistTask,
  conversationId: string,
) {
  return task.parentId === conversationId;
}

/** A waiting state is actionable only in the thread that owns the work. */
export function specialistNeedsUserInThread(
  task: SpecialistTask,
  threadRootId: string,
  openActionSourceIds: ReadonlySet<string>,
) {
  return (
    openActionSourceIds.has(task.id) &&
    task.triggerContext?.threadRootId === threadRootId
  );
}

function delegationIds(input: JsonValue | undefined) {
  if (!input || !isJsonObject(input)) return undefined;
  const value = input;
  if (isJsonString(value.delegationId)) return [value.delegationId];
  if (!isJsonString(value.code)) return undefined;
  return Array.from(
    value.code.matchAll(/delegationId\s*:\s*["']([^"']+)["']/g),
    (match) => match[1],
  ).filter((id): id is string => Boolean(id));
}

function delegatedAgentIds(input: JsonValue | undefined) {
  if (!input || !isJsonObject(input)) return undefined;
  const value = input;
  if (isJsonString(value.agentId) && isJsonString(value.delegationId)) {
    return [value.agentId];
  }
  if (
    !isJsonString(value.code) ||
    !value.code.includes("specialistsDelegate")
  ) {
    return undefined;
  }
  return Array.from(
    value.code.matchAll(/agentId\s*:\s*["']([^"']+)["']/g),
    (match) => match[1],
  ).filter((id): id is string => Boolean(id));
}

export function specialistTasksForInput<T extends SpecialistTask>(
  input: JsonValue | undefined,
  tasks: readonly T[],
) {
  const matches: T[] = [];
  const seen = new Set<string>();
  for (const triggerId of delegationIds(input) ?? []) {
    const exact = tasks.find((candidate) => candidate.triggerId === triggerId);
    if (exact && !seen.has(exact.id)) {
      seen.add(exact.id);
      matches.push(exact);
    }
  }
  if (matches.length > 0) return matches;

  for (const agentId of delegatedAgentIds(input) ?? []) {
    const candidates = tasks.filter((candidate) => candidate.agent === agentId);
    if (
      candidates.length === 1 &&
      candidates[0] &&
      !seen.has(candidates[0].id)
    ) {
      seen.add(candidates[0].id);
      matches.push(candidates[0]);
    }
  }
  return matches;
}

export function specialistTaskForInput<T extends SpecialistTask>(
  input: JsonValue | undefined,
  tasks: readonly T[],
) {
  return specialistTasksForInput(input, tasks)[0];
}

export function specialistTaskOwners(
  messages: readonly { id: string; blocks: readonly ToolBlock[] }[],
  tasks: readonly SpecialistTask[],
) {
  const owners = new Map<string, string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool_use") continue;
      for (const task of specialistTasksForInput(
        parseJsonValue(block.input),
        tasks,
      )) {
        if (!owners.has(task.id)) owners.set(task.id, message.id);
      }
    }
  }
  return owners;
}

export function ordinaryToolMessageGroups<
  TBlock extends ToolBlock,
  TTask extends SpecialistTask,
>(messages: readonly TranscriptMessage<TBlock>[], tasks: readonly TTask[]) {
  const groups = new Map<
    string,
    { ownerId: string; messageIds: string[]; blocks: TBlock[] }
  >();
  let current:
    { ownerId: string; messageIds: string[]; blocks: TBlock[] } | undefined;

  for (const message of messages) {
    const activityBlocks = message.blocks.filter(
      (block) => block.type === "tool_use" || block.type === "tool_result",
    );
    const ordinaryToolsOnly =
      message.role === "assistant" &&
      activityBlocks.length > 0 &&
      message.blocks.every(
        (block) =>
          (block.type === "thinking" ||
            block.type === "tool_use" ||
            block.type === "tool_result") &&
          (block.type !== "tool_use" ||
            specialistTasksForInput(parseJsonValue(block.input), tasks)
              .length === 0),
      );
    if (!ordinaryToolsOnly) {
      current = undefined;
      continue;
    }
    current ??= { ownerId: message.id, messageIds: [], blocks: [] };
    current.messageIds.push(message.id);
    current.blocks.push(...activityBlocks);
    groups.set(message.id, current);
  }
  return groups;
}
