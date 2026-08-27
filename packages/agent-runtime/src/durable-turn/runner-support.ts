import type { AgentInferenceToolCall } from "@chief/agent-computer";

import type { CellPersistence } from "../cells/sqlite-store.js";
import type { DurableTool, DurableTurn, ToolEffect } from "./types.js";
import { compactCheckpointEvidence } from "./context.js";
import { isTodoTool } from "./plan.js";
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
