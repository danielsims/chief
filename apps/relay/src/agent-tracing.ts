import { tracing } from "cloudflare:workers";

import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

export interface HostedAgentTraceContext {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  jobId: string;
  includeContent: boolean;
}

export function traceAgentRun<T>(
  context: HostedAgentTraceContext,
  revision: number,
  run: () => Promise<T>,
) {
  return tracing.enterSpan(`invoke_agent ${context.agentId}`, (span) => {
    span.setAttributes({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": context.agentId,
      "gen_ai.agent.id": `${context.workspaceId}:${context.agentId}`,
      "gen_ai.conversation.id": context.conversationId,
      "chief.workspace.id": context.workspaceId,
      "chief.job.id": context.jobId,
      "chief.turn.revision": revision,
    });
    return run();
  });
}

export function tracedInference(
  inference: AgentInference,
  context: HostedAgentTraceContext,
): AgentInference {
  return {
    model: inference.model,
    estimateTokens: inference.estimateTokens?.bind(inference),
    complete: (request) =>
      tracing.enterSpan(`chat ${inference.model?.id ?? "unknown"}`, (span) => {
        span.setAttributes({
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "opencode",
          "gen_ai.request.model": inference.model?.id,
          "gen_ai.agent.name": context.agentId,
          "gen_ai.agent.id": `${context.workspaceId}:${context.agentId}`,
          "gen_ai.conversation.id": context.conversationId,
          "chief.job.id": context.jobId,
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
        });
        return inference.complete(request).then((result) => {
          if (context.includeContent) {
            span.setAttribute("gen_ai.output.messages", traceText(result));
          }
          return result;
        });
      }),
  };
}

export function traceToolExecution(
  context: HostedAgentTraceContext,
  call: AgentInferenceToolCall,
  execute: () => Promise<JsonValue>,
) {
  return tracing.enterSpan(`execute_tool ${call.name}`, (span) => {
    span.setAttributes({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": call.name,
      "gen_ai.tool.call.id": call.id,
      "gen_ai.agent.name": context.agentId,
      "gen_ai.agent.id": `${context.workspaceId}:${context.agentId}`,
      "gen_ai.conversation.id": context.conversationId,
      "chief.job.id": context.jobId,
      ...(context.includeContent
        ? { "gen_ai.tool.call.arguments": traceText(call.arguments) }
        : undefined),
    });
    return execute().then((result) => {
      if (context.includeContent) {
        span.setAttribute("gen_ai.tool.call.result", traceText(result));
      }
      return result;
    });
  });
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
