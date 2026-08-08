interface SpecialistTask {
  id: string;
  agent: string;
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

export function chronologicallyMergeSpecialistTasks<
  TMessage extends { metadata?: { createdAt?: number } },
  TTask extends SpecialistTask & { createdAt: number },
>(messages: readonly TMessage[], tasks: readonly TTask[]) {
  const pendingTasks = [...tasks].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
  const entries: (
    { type: "message"; message: TMessage } | { type: "specialist"; task: TTask }
  )[] = [];
  let taskIndex = 0;
  for (const message of messages) {
    const messageCreatedAt = message.metadata?.createdAt ?? 0;
    while (taskIndex < pendingTasks.length) {
      const task = pendingTasks[taskIndex];
      if (!task || task.createdAt > messageCreatedAt) break;
      entries.push({ type: "specialist", task });
      taskIndex += 1;
    }
    entries.push({ type: "message", message });
  }
  for (const task of pendingTasks.slice(taskIndex)) {
    entries.push({ type: "specialist", task });
  }
  return entries;
}

function delegationIds(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (typeof value.delegationId === "string") return [value.delegationId];
  if (typeof value.code !== "string") return undefined;
  return Array.from(
    value.code.matchAll(/delegationId\s*:\s*["']([^"']+)["']/g),
    (match) => match[1],
  ).filter((id): id is string => Boolean(id));
}

function delegatedAgentIds(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (
    typeof value.agentId === "string" &&
    typeof value.delegationId === "string"
  ) {
    return [value.agentId];
  }
  if (
    typeof value.code !== "string" ||
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
  input: unknown,
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
  input: unknown,
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
      for (const task of specialistTasksForInput(block.input, tasks)) {
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
    const ordinaryToolsOnly =
      message.role === "assistant" &&
      message.blocks.length > 0 &&
      message.blocks.every(
        (block) =>
          (block.type === "tool_use" || block.type === "tool_result") &&
          (block.type !== "tool_use" ||
            specialistTasksForInput(block.input, tasks).length === 0),
      );
    if (!ordinaryToolsOnly) {
      current = undefined;
      continue;
    }
    current ??= { ownerId: message.id, messageIds: [], blocks: [] };
    current.messageIds.push(message.id);
    current.blocks.push(...message.blocks);
    groups.set(message.id, current);
  }
  return groups;
}
