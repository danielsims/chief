import type { AgentInferenceToolCall } from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";
import { isJsonObject } from "@chief/relay-contracts";

import type { CellPersistence } from "../cells/sqlite-store.js";
import type { DurableTool, DurableTurn, ToolEffect } from "./types.js";
import { compactCheckpointEvidence } from "./context.js";
import { durableTodoTools, isTodoTool } from "./plan.js";
import { isRecoverableToolError } from "./tool-errors.js";
import { durableTurnSchema } from "./types.js";

export async function persistTurn(
  persistence: CellPersistence,
  cellId: string,
  turn: DurableTurn,
) {
  const parsed = durableTurnSchema.parse(turn);
  const persisted = parsed.checkpoint
    ? {
        ...parsed,
        checkpoint: {
          ...parsed.checkpoint,
          evidence: compactCheckpointEvidence(parsed.checkpoint.evidence),
        },
        tools: retainedToolReceipts(parsed),
      }
    : parsed;
  await persistence.writeState(
    cellId,
    "durable-turn",
    durableTurnSchema.parse(persisted),
  );
}

export function retainedToolReceipts(turn: DurableTurn): DurableTurn["tools"] {
  const retained = new Set<number>();
  for (let index = 0; index < turn.tools.length; index += 1) {
    if (turn.tools[index]?.state !== "completed") retained.add(index);
  }
  for (
    let index = Math.max(0, turn.tools.length - 3);
    index < turn.tools.length;
    index += 1
  ) {
    retained.add(index);
  }
  const required = new Set(turn.completion.requiredToolNames);
  let browserLifecycleFound = false;
  for (let index = turn.tools.length - 1; index >= 0; index -= 1) {
    const receipt = turn.tools[index];
    if (receipt?.state !== "completed") continue;
    if (required.delete(receipt.call.name)) retained.add(index);
    if (
      !browserLifecycleFound &&
      (receipt.call.name === "browser_open" ||
        receipt.call.name === "browser_close")
    ) {
      retained.add(index);
      browserLifecycleFound = true;
    }
  }
  return turn.tools.filter((_receipt, index) => retained.has(index));
}

export function prepareToolReceiptForRetry(
  turn: DurableTurn,
  callId: string,
): DurableTurn["tools"] {
  return turn.tools.map((candidate) =>
    candidate.call.id === callId
      ? { ...candidate, state: "prepared" as const }
      : candidate,
  );
}

export function isBareSpeakerLabel(value: string) {
  return /^[\p{L}\p{N}_ -]{1,64}:$/u.test(value);
}

export async function notify(
  notification: () => Promise<void> | void | undefined,
) {
  try {
    await notification();
  } catch {
    // Observability is a projection of durable work, never a prerequisite.
  }
}

export function effectFor(
  call: AgentInferenceToolCall,
  tools: readonly DurableTool[],
) {
  if (isTodoTool(call.name)) return "idempotent" as const;
  const tool = tools.find(
    (candidate) => candidate.definition.name === call.name,
  );
  if (!tool) throw new Error(`Unknown durable tool: ${call.name}`);
  return tool.effect;
}

export function shouldPauseAfterToolFailure(
  effect: ToolEffect,
  failure: Error,
) {
  return effect === "non_replayable" && !isRecoverableToolError(failure);
}

export function unavailableToolNames(turn: DurableTurn) {
  const unavailable = new Set<string>();
  const failedSignatures = new Map<string, number>();
  for (const receipt of turn.tools) {
    if (receipt.state !== "completed" || !toolResultFailed(receipt.result)) {
      continue;
    }
    if (toolResultUnavailable(receipt.result)) {
      unavailable.add(receipt.call.name);
      continue;
    }
    const signature = JSON.stringify([
      receipt.call.name,
      receipt.call.arguments,
      receipt.result,
    ]);
    const count = (failedSignatures.get(signature) ?? 0) + 1;
    failedSignatures.set(signature, count);
    if (count >= 3) unavailable.add(receipt.call.name);
  }
  return unavailable;
}

export function availableToolDefinitions(
  turn: DurableTurn,
  tools: readonly DurableTool[],
) {
  const unavailable = unavailableToolNames(turn);
  return [
    ...tools
      .filter((tool) => !unavailable.has(tool.definition.name))
      .map((tool) => tool.definition),
    ...durableTodoTools,
  ];
}

export function toolResultFailed(value: JsonValue | undefined) {
  return isJsonObject(value) && value.ok === false;
}

export function toolFeedbackMessages(
  messages: DurableTurn["messages"],
  toolName: string,
  repeated: number,
  failed: boolean,
): DurableTurn["messages"] {
  if (repeated >= 3 && failed) {
    return [
      ...messages,
      {
        role: "system",
        content: `${toolName} is unavailable for the rest of this turn after three identical failures. Continue with another source or method, or answer with the useful evidence you have. Do not wait for or call this tool again.`,
      },
    ];
  }
  if (repeated === 2) {
    return [
      ...messages,
      {
        role: "system",
        content: `${toolName} returned the same result twice for identical arguments. Choose a different action, report a genuine blocker, or complete the task; do not repeat this call unchanged.`,
      },
    ];
  }
  return messages;
}

function toolResultUnavailable(value: JsonValue | undefined) {
  return isJsonObject(value) && value.unavailableForTurn === true;
}
