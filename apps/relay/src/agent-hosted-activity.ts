import { z } from "zod";

import type {
  AgentInferenceResult,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type {
  DurableTurn,
  DurableTurnObserver,
} from "@chief/agent-runtime/durable-turn";
import type {
  agentJobSchema,
  AgentPrincipal,
  JsonValue,
} from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import { publishAgentActivity } from "./agent-activity";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;

export function hostedActivityObserver(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
): DurableTurnObserver {
  const conversationId = isJsonString(job.payload.conversationId)
    ? job.payload.conversationId
    : "mission-control";
  const threadRootId = isJsonString(job.payload.threadRootId)
    ? job.payload.threadRootId
    : undefined;
  const correlation = { runId: job.id, jobId: job.id };
  const publish = (
    seed: string,
    component: Parameters<typeof publishAgentActivity>[1]["component"],
  ) =>
    publishAgentActivity(env, {
      principal,
      conversationId,
      ...(threadRootId ? { threadRootId } : undefined),
      seed: `${job.id}:${seed}`,
      component,
    });

  return {
    inferenceStarted: (turn) =>
      publish(hostedInferenceActivitySeed(turn), {
        kind: "thinking",
        version: 1,
        payload: {
          text: `${job.agentId} is working through the next step.`,
          status: "working",
          ...correlation,
        },
      }),
    inferenceCompleted: (turn, result: AgentInferenceResult) =>
      publish(hostedInferenceActivitySeed(turn), {
        kind: "thinking",
        version: 1,
        payload: {
          text: result.content?.trim()
            ? result.content.slice(0, 100_000)
            : `Prepared ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? "" : "s"}.`,
          status: "completed",
          ...correlation,
        },
      }),
    toolStarted: (_turn, call) =>
      publish(`tool:${call.id}`, {
        kind: "tool",
        version: 1,
        payload: {
          name: call.name,
          status: "running",
          input: activityText(call.arguments),
          ...correlation,
        },
      }),
    toolCompleted: (_turn, call, result) =>
      publish(`tool:${call.id}`, {
        kind: "tool",
        version: 1,
        payload: {
          name: call.name,
          status: "completed",
          input: activityText(call.arguments),
          output: activityText(result),
          ...correlation,
        },
      }),
    toolFailed: (_turn, call, error) =>
      publish(`tool:${call.id}`, {
        kind: "tool",
        version: 1,
        payload: {
          name: call.name,
          status: "failed",
          input: activityText(call.arguments),
          error: error.message.slice(0, 100_000),
          ...correlation,
        },
      }),
  };
}

export function hostedInferenceActivitySeed(
  turn: Pick<DurableTurn, "revision">,
) {
  return `thinking:${turn.revision}`;
}

function activityText(
  value: AgentInferenceToolCall["arguments"] | JsonValue,
): string {
  const text = isJsonString(value)
    ? z.string().parse(value)
    : JSON.stringify(value);
  return text.slice(0, 100_000);
}
