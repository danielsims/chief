import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { AgentJob, JsonValue } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import type { AsyncTracer } from "./effect";

export interface HostedAgentTraceContext {
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  conversationId: string;
  jobId: string;
  workflowId: string;
  messageId?: string;
  includeContent: boolean;
}

export function agentWorkflowId(job: AgentJob) {
  return isJsonString(job.payload.workflowId) ? job.payload.workflowId : job.id;
}

export function agentTelemetryAttributes(job: AgentJob) {
  return {
    "chief.workspace.id": job.workspaceId,
    "chief.workflow.id": agentWorkflowId(job),
    "chief.job.id": job.id,
    "gen_ai.agent.name": job.agentId,
    "gen_ai.conversation.id": isJsonString(job.payload.conversationId)
      ? job.payload.conversationId
      : "mission-control",
    ...(isJsonString(job.payload.messageId)
      ? { "messaging.message.id": job.payload.messageId }
      : undefined),
  };
}

export function traceAgentRun<T>(
  tracer: AsyncTracer,
  context: HostedAgentTraceContext,
  revision: number,
  run: (children: AsyncTracer) => Promise<T>,
) {
  return tracer.run(
    `invoke_agent ${context.agentId}`,
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": context.agentId,
      "gen_ai.agent.id": `${context.workspaceId}:${context.agentId}`,
      "gen_ai.conversation.id": context.conversationId,
      "chief.workspace.id": context.workspaceId,
      "chief.workspace.name": context.workspaceName,
      "chief.job.id": context.jobId,
      "chief.workflow.id": context.workflowId,
      "messaging.message.id": context.messageId,
      "chief.turn.revision": revision,
    },
    ({ children }) => run(children),
  );
}

export function tracedInference(
  inference: AgentInference,
  context: HostedAgentTraceContext,
  tracer: AsyncTracer,
): AgentInference {
  return {
    model: inference.model,
    estimateTokens: inference.estimateTokens?.bind(inference),
    complete: (request) =>
      tracer.run(
        `chat ${inference.model?.id ?? "unknown"}`,
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "opencode",
          "gen_ai.request.model": inference.model?.id,
          "gen_ai.agent.name": context.agentId,
          "gen_ai.agent.id": `${context.workspaceId}:${context.agentId}`,
          "gen_ai.conversation.id": context.conversationId,
          "chief.workspace.id": context.workspaceId,
          "chief.workspace.name": context.workspaceName,
          "chief.job.id": context.jobId,
          "chief.workflow.id": context.workflowId,
          "messaging.message.id": context.messageId,
          ...(context.includeContent
            ? {
                "gen_ai.input.messages": traceText(request.messages),
                "gen_ai.system_instructions": traceText(
                  request.messages
                    .filter((message) => message.role === "system")
                    .map((message) => message.content),
                ),
              }
            : undefined),
        },
        async (span) => {
          const result = await inference.complete(request);
          if (context.includeContent) {
            span.annotate("gen_ai.output.messages", traceText(result));
          }
          return result;
        },
      ),
  };
}

export function traceToolExecution(
  tracer: AsyncTracer,
  context: HostedAgentTraceContext,
  call: AgentInferenceToolCall,
  execute: () => Promise<JsonValue>,
) {
  return tracer.run(
    `execute_tool ${call.name}`,
    {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": call.name,
      "gen_ai.tool.call.id": call.id,
      "gen_ai.agent.name": context.agentId,
      "gen_ai.agent.id": `${context.workspaceId}:${context.agentId}`,
      "gen_ai.conversation.id": context.conversationId,
      "chief.workspace.id": context.workspaceId,
      "chief.workspace.name": context.workspaceName,
      "chief.job.id": context.jobId,
      "chief.workflow.id": context.workflowId,
      "messaging.message.id": context.messageId,
      ...(context.includeContent
        ? { "gen_ai.tool.call.arguments": traceText(call.arguments) }
        : undefined),
    },
    async (span) => {
      const result = await execute();
      if (context.includeContent) {
        span.annotate("gen_ai.tool.call.result", traceText(result));
      }
      return result;
    },
  );
}

type TracePayload =
  | AgentInferenceRequest["messages"]
  | AgentInferenceResult
  | AgentInferenceToolCall["arguments"]
  | JsonValue
  | readonly (string | null)[];

function traceText(value: TracePayload) {
  return JSON.stringify(value).slice(0, 100_000);
}
