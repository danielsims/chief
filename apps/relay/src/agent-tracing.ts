import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { DurableTurnStateSize } from "@chief/agent-runtime/durable-turn";
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

export function durableTurnStateAttributes(size: DurableTurnStateSize) {
  return {
    "chief.turn.state.bytes": size.totalBytes,
    "chief.turn.state.structural.bytes": size.structuralBytes,
    "chief.turn.state.instruction.bytes": size.instructionBytes,
    "chief.turn.state.system_prompt.bytes": size.systemPromptBytes,
    "chief.turn.state.messages.bytes": size.messagesBytes,
    "chief.turn.state.messages.content.bytes": size.messageContentBytes,
    "chief.turn.state.messages.tool_calls.bytes": size.messageToolCallsBytes,
    "chief.turn.state.plan.bytes": size.planBytes,
    "chief.turn.state.tools.bytes": size.toolsBytes,
    "chief.turn.state.tools.arguments.bytes": size.toolArgumentsBytes,
    "chief.turn.state.tools.results.bytes": size.toolResultsBytes,
    "chief.turn.state.checkpoint.bytes": size.checkpointBytes,
    "chief.turn.state.checkpoint.memory.bytes": size.checkpointMemoryBytes,
    "chief.turn.state.checkpoint.evidence.bytes": size.checkpointEvidenceBytes,
    "chief.turn.state.metadata.bytes": size.metadataBytes,
    "chief.turn.state.messages.count": size.messageCount,
    "chief.turn.state.tools.count": size.toolReceiptCount,
    "chief.turn.state.checkpoint.evidence.count": size.checkpointEvidenceCount,
    "chief.turn.state.largest_message.bytes": size.largestMessageBytes,
    "chief.turn.state.largest_message.role": size.largestMessageRole,
    "chief.turn.state.largest_tool_result.bytes": size.largestToolResultBytes,
    "chief.turn.state.largest_tool_result.name": size.largestToolResultName,
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
