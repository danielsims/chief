import { z } from "zod";

import type {
  AgentBrowser,
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
import { agentToolName } from "@chief/agent-runtime/local-tools";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import { publishAgentActivity } from "./agent-activity";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;
const browserOpenToolName = agentToolName("browser.open");
const browserCloseToolName = agentToolName("browser.close");

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
    inferenceCompleted: (turn, result: AgentInferenceResult) => {
      const text = result.content?.trim();
      if (!text) return;
      return publish(hostedInferenceActivitySeed(turn), {
        kind: "thinking",
        version: 1,
        payload: {
          text: text.slice(0, 100_000),
          status: "completed",
          ...correlation,
        },
      });
    },
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

export async function publishHostedBrowserActivity(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  browser: AgentBrowser,
  toolName: string,
  result: JsonValue,
) {
  if (toolName !== browserOpenToolName && toolName !== browserCloseToolName)
    return;
  const conversationId = isJsonString(job.payload.conversationId)
    ? job.payload.conversationId
    : "mission-control";
  const threadRootId = isJsonString(job.payload.threadRootId)
    ? job.payload.threadRootId
    : undefined;
  const closed = toolName === browserCloseToolName;
  const stream = closed ? undefined : await browser.stream?.();
  if (!closed && !stream) return;
  const url =
    isJsonObject(result) && isJsonString(result.url) ? result.url : undefined;
  await publishAgentActivity(env, {
    principal,
    conversationId,
    ...(threadRootId ? { threadRootId } : undefined),
    seed: `${job.id}:browser`,
    component: {
      kind: "browser",
      version: 1,
      payload: {
        browserRunId: job.id,
        status: closed ? "closed" : "active",
        ...(url ? { url } : undefined),
        ...(stream
          ? { streamUrl: stream.streamUrl, expiresAt: stream.expiresAt }
          : undefined),
        runId: job.id,
        jobId: job.id,
      },
    },
  });
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
