import { Effect } from "effect";
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
import { isRecoverableToolError } from "@chief/agent-runtime/durable-turn";
import { agentToolName } from "@chief/agent-runtime/local-tools";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import { publishAgentActivity } from "./agent-activity";
import { runEffect } from "./effect";

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
      // Tool calls are the durable source of truth. Intermediate model prose
      // often describes intended work and must never look like completion.
      if (result.toolCalls.length > 0) return;
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
    toolFailed: async (_turn, call, error) => {
      await publish(`tool:${call.id}`, {
        kind: "tool",
        version: 1,
        payload: {
          name: call.name,
          status: "failed",
          input: activityText(call.arguments),
          error: error.message.slice(0, 100_000),
          ...correlation,
        },
      });
      // Tool errors are valid durable-turn results, so the enclosing Durable
      // Object invocation can still complete successfully. Emit a dedicated
      // error record as well as the UI component so Workers logs and external
      // OTLP backends can find the failure without misclassifying the turn.
      const attributes = {
        "chief.workspace.id": job.workspaceId,
        "chief.job.id": job.id,
        "chief.workflow.id": isJsonString(job.payload.workflowId)
          ? job.payload.workflowId
          : job.id,
        "gen_ai.agent.name": job.agentId,
        "gen_ai.conversation.id": conversationId,
        "gen_ai.tool.name": call.name,
        "gen_ai.tool.call.id": call.id,
        error: error.message.slice(0, 10_000),
      };
      await runEffect(
        isRecoverableToolError(error)
          ? Effect.logWarning("agent.tool.unavailable", attributes)
          : Effect.logError("agent.tool.failed", attributes),
        env,
        isJsonString(job.payload.workflowId) ? job.payload.workflowId : job.id,
      ).catch(() => undefined);
    },
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
