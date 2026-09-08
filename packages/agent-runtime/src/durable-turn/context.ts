import type {
  AgentInference,
  AgentInferenceMessage,
  AgentInferenceTool,
} from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

import type { DurableTurn } from "./types.js";
import { serializedBytes } from "./state-size.js";
import { checkpointMemorySchema } from "./types.js";

const RECENT_MESSAGE_COUNT = 10;
const MAX_DURABLE_STATE_BYTES = 256_000;
const MAX_CHECKPOINT_EVIDENCE = 12;
const MAX_EVIDENCE_CHARS = 6_000;

export interface ContextPolicy {
  compactionRatio: number;
}

export function recentCompleteMessages(
  messages: readonly DurableTurn["messages"][number][],
) {
  let start = Math.max(0, messages.length - RECENT_MESSAGE_COUNT);
  while (start > 0 && messages[start]?.role === "tool") start -= 1;
  if (messages[start]?.role === "assistant") {
    return messages.slice(start);
  }
  while (messages[start]?.role === "tool") start += 1;
  return messages.slice(start);
}

export function validateCompactionRatio(value: number) {
  if (!Number.isFinite(value) || value < 0.5 || value > 0.95) {
    throw new Error("The compaction ratio must be between 0.5 and 0.95.");
  }
  return value;
}

export function inferenceMessages(turn: DurableTurn) {
  const plan = planMessage(turn);
  if (!turn.checkpoint) {
    return [
      { role: "system" as const, content: turn.systemPrompt },
      ...turn.messages,
      ...(plan ? [plan] : []),
    ] satisfies AgentInferenceMessage[];
  }
  const tail = recentCompleteMessages(turn.messages).filter(
    (message, index) =>
      !(
        index === 0 &&
        message.role === "user" &&
        message.content === turn.instruction
      ),
  );
  return [
    { role: "system", content: turn.systemPrompt },
    { role: "user", content: turn.instruction },
    {
      role: "system",
      content: `Durable working checkpoint, generation ${turn.checkpoint.generation}:\n${JSON.stringify(turn.checkpoint.memory)}`,
    },
    {
      role: "system",
      content: `Runtime-verified tool evidence:\n${JSON.stringify(turn.checkpoint.evidence)}`,
    },
    ...(plan ? [plan] : []),
    ...tail,
  ] satisfies AgentInferenceMessage[];
}

export function shouldCompact(input: {
  inference: AgentInference;
  turn: DurableTurn;
  tools: readonly AgentInferenceTool[];
  maxOutputTokens: number;
  policy: ContextPolicy;
}) {
  if (
    input.turn.checkpoint &&
    input.turn.messages.length <= RECENT_MESSAGE_COUNT
  ) {
    return false;
  }
  const model = input.inference.model;
  if (!model) return false;
  if (serializedBytes(input.turn) >= MAX_DURABLE_STATE_BYTES) {
    return true;
  }
  const request = {
    messages: inferenceMessages(input.turn),
    tools: input.tools,
    maxTokens: input.maxOutputTokens,
    temperature: 0,
  };
  const estimated = input.inference.estimateTokens
    ? input.inference.estimateTokens(request)
    : estimateTokens(request);
  const ratioLimit = Math.floor(
    model.contextWindowTokens * input.policy.compactionRatio,
  );
  const outputSafeLimit = model.contextWindowTokens - input.maxOutputTokens;
  return estimated >= Math.min(ratioLimit, outputSafeLimit);
}

export async function compactTurn(input: {
  inference: AgentInference;
  turn: DurableTurn;
  policy: ContextPolicy;
}) {
  const model = input.inference.model;
  if (!model) {
    throw new Error("Compaction requires model context metadata.");
  }
  const evidence = compactCheckpointEvidence([
    ...(input.turn.checkpoint?.evidence ?? []),
    ...input.turn.tools
      .filter((tool) => tool.state === "completed" && tool.result !== undefined)
      .map((tool) => ({
        callId: tool.call.id,
        name: tool.call.name,
        result: tool.result ?? null,
      })),
  ]);
  const response = await input.inference.complete({
    messages: [
      {
        role: "user",
        content: compactionPrompt(input.turn, evidence),
      },
    ],
    tools: [],
    maxTokens: Math.min(4_000, model.maxOutputTokens ?? 4_000),
    temperature: 0.1,
  });
  const memory = parseCheckpoint(response.content) ?? fallback(input.turn);
  const estimatedInputTokens = input.inference.estimateTokens
    ? input.inference.estimateTokens({
        messages: inferenceMessages(input.turn),
        tools: [],
        maxTokens: 2_000,
        temperature: 0,
      })
    : estimateTokens({ messages: inferenceMessages(input.turn), tools: [] });
  return {
    generation: (input.turn.checkpoint?.generation ?? 0) + 1,
    sourceMessageCount: input.turn.messages.length,
    memory,
    evidence,
    trigger: {
      ratio: input.policy.compactionRatio,
      modelId: model.id,
      contextWindowTokens: model.contextWindowTokens,
      estimatedInputTokens,
    },
  };
}

function planMessage(turn: DurableTurn): AgentInferenceMessage | undefined {
  if (turn.plan.tasks.length === 0) return undefined;
  return {
    role: "system",
    content: `Authoritative durable task plan, revision ${turn.plan.revision}:\n${JSON.stringify(turn.plan.tasks)}`,
  };
}

function compactionPrompt(turn: DurableTurn, evidence: readonly object[]) {
  return `Create a precise durable handoff for an agent continuing in a fresh model context.

Return JSON only with these fields: objective, completed, active,
criticalContext, verifiedEvidence, artifacts, failedApproaches, constraints,
nextAction, openQuestions. All fields except objective and nextAction are
arrays. verifiedEvidence is an array of {"claim": string, "source": string}.

Preserve exact paths, URLs, identifiers, commands, errors, decisions and user
constraints. Never claim unfinished work is complete. The task plan and
runtime-verified tool evidence outrank narrative history.

Exact original instruction:
${turn.instruction}

Previous durable checkpoint:
${JSON.stringify(turn.checkpoint?.memory ?? null)}

Authoritative task plan:
${JSON.stringify(turn.plan)}

Runtime-verified tool evidence:
${JSON.stringify(evidence)}

Chronological active history:
${turn.messages
  .map(
    (message, index) =>
      `[message:${index + 1}] ${message.role}: ${message.content ?? JSON.stringify(message.toolCalls ?? [])}`,
  )
  .join("\n\n")}`;
}

export function boundedEvidenceValue(value: JsonValue): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_EVIDENCE_CHARS) return value;
  return `[truncated durable evidence, original characters: ${serialized.length}] ${serialized.slice(0, MAX_EVIDENCE_CHARS)}`;
}

export function compactCheckpointEvidence(
  evidence: readonly {
    callId: string;
    name: string;
    result: JsonValue;
  }[],
) {
  const byCallId = new Map(
    evidence.map((item) => [
      item.callId,
      { ...item, result: boundedEvidenceValue(item.result) },
    ]),
  );
  return [...byCallId.values()].slice(-MAX_CHECKPOINT_EVIDENCE);
}

function parseCheckpoint(content: string | null) {
  if (!content) return undefined;
  const match = /\{[\s\S]*\}/u.exec(content);
  if (!match) return undefined;
  try {
    return checkpointMemorySchema.parse(JSON.parse(match[0]));
  } catch {
    return undefined;
  }
}

function fallback(turn: DurableTurn) {
  const open = turn.plan.tasks.filter((task) => task.status !== "completed");
  const completed = turn.plan.tasks.filter(
    (task) => task.status === "completed",
  );
  return checkpointMemorySchema.parse({
    objective: turn.instruction,
    completed: completed.map((task) => task.text),
    active: open.map((task) => task.text),
    criticalContext: [],
    verifiedEvidence: completed.flatMap((task) =>
      task.evidence ? [{ claim: task.text, source: task.evidence }] : [],
    ),
    artifacts: [],
    failedApproaches: [],
    constraints: [],
    nextAction: open[0]?.text ?? "Verify the result and answer the user.",
    openQuestions: [],
  });
}

function estimateTokens(input: {
  messages: readonly AgentInferenceMessage[];
  tools: readonly AgentInferenceTool[];
}) {
  return Math.max(0, Math.round(JSON.stringify(input).length / 4));
}
