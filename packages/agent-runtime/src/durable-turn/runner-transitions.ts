import type {
  AgentInferenceResult,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

import type { DurableTool, DurableTurn } from "./types.js";
import { finishTurn, repeatedCompletedTool } from "./completion.js";
import { boundedEvidenceValue } from "./context.js";
import {
  consecutiveToolFailures,
  effectFor,
  isBareSpeakerLabel,
  toolFeedbackMessages,
  toolResultFailed,
} from "./runner-support.js";
import { durableToolCallSchema, durableTurnSchema } from "./types.js";

export function updatedTurn(
  turn: DurableTurn,
  patch: Partial<DurableTurn>,
): DurableTurn {
  return durableTurnSchema.parse({
    ...turn,
    ...patch,
    revision: turn.revision + 1,
    updatedAt: new Date().toISOString(),
  });
}

export function startTurnFinalization(turn: DurableTurn, reason: string) {
  return updatedTurn(turn, {
    finalization: { reason },
    phase: { kind: "runnable", next: { kind: "infer" } },
    claim: null,
  });
}

export function commitTurnInference(
  turn: DurableTurn,
  response: AgentInferenceResult,
  tools: readonly DurableTool[],
) {
  const toolCalls = response.toolCalls.map((call) =>
    durableToolCallSchema.parse(call),
  );
  const messages = [
    ...turn.messages,
    {
      role: "assistant" as const,
      content: response.content,
      ...(response.reasoning ? { reasoning: response.reasoning } : undefined),
      ...(toolCalls.length > 0 ? { toolCalls } : undefined),
    },
  ];
  const inferenceSteps = turn.inferenceSteps + 1;
  if (toolCalls.length > 0) {
    const receipts = toolCalls.map((call) => ({
      call,
      effect: effectFor(call, tools),
      state: "prepared" as const,
    }));
    return updatedTurn(turn, {
      messages,
      inferenceSteps,
      tools: [...turn.tools, ...receipts],
      phase: {
        kind: "runnable",
        next: { kind: "tool", callId: toolCalls[0]?.id ?? "" },
      },
      claim: null,
    });
  }

  const result = response.content?.trim();
  if (!result || isBareSpeakerLabel(result)) {
    throw new Error("The agent returned an empty response.");
  }
  if (turn.finalization) {
    return updatedTurn(turn, {
      messages,
      inferenceSteps,
      phase: { kind: "completed", result },
      claim: null,
    });
  }
  const finish = finishTurn(turn, result);
  if (finish.kind === "retry") {
    return updatedTurn(turn, {
      messages: [...messages, { role: "system", content: finish.message }],
      inferenceSteps,
      ...(finish.rejectedFinishes === undefined
        ? undefined
        : {
            completion: {
              ...turn.completion,
              rejectedFinishes: finish.rejectedFinishes,
            },
          }),
      claim: null,
    });
  }
  if (finish.kind === "failed") {
    return updatedTurn(turn, {
      messages,
      inferenceSteps,
      phase: { kind: "failed", error: finish.error },
      claim: null,
    });
  }
  return updatedTurn(turn, {
    messages,
    inferenceSteps,
    phase: { kind: "completed", result: finish.result },
    claim: null,
  });
}

export function commitTurnTool(
  turn: DurableTurn,
  call: AgentInferenceToolCall,
  result: JsonValue,
) {
  const durableResult = boundedEvidenceValue(result);
  const tools = turn.tools.map((candidate) =>
    candidate.call.id === call.id
      ? { ...candidate, state: "completed" as const, result: durableResult }
      : candidate,
  );
  const next = tools.find((candidate) => candidate.state === "prepared");
  const repeated = repeatedCompletedTool(tools);
  const messages = [
    ...turn.messages,
    {
      role: "tool" as const,
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify(durableResult),
    },
  ];
  const failureCount = consecutiveToolFailures({ ...turn, tools });
  if (failureCount >= 6) {
    return startTurnFinalization(
      { ...turn, tools, messages },
      "The agent encountered six consecutive tool failures without progress.",
    );
  }
  if (repeated >= 3 && !toolResultFailed(durableResult)) {
    return startTurnFinalization(
      { ...turn, tools, messages },
      `The agent repeated ${call.name} with the same arguments and result three times without progress.`,
    );
  }
  return updatedTurn(turn, {
    tools,
    messages: toolFeedbackMessages(
      messages,
      call.name,
      repeated,
      toolResultFailed(durableResult),
    ),
    phase: {
      kind: "runnable",
      next: next ? { kind: "tool", callId: next.call.id } : { kind: "infer" },
    },
    claim: null,
  });
}
