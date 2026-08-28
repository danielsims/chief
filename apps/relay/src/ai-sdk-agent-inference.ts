import type { ModelMessage, ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapAISDK } from "agents/observability/ai";
import * as aiSdk from "ai";
import { z } from "zod";

import type {
  AgentInference,
  AgentInferenceMessage,
  AgentInferenceRequest,
  AgentInferenceTool,
} from "@chief/agent-computer";
import { jsonObjectSchema } from "@chief/relay-contracts";

import type { HostedAgentTraceContext } from "./agent-tracing";

const OPEN_CODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const OPEN_CODE_GO_MODEL = "deepseek-v4-flash";
export const HOSTED_INFERENCE_TIMEOUT_MS = 45_000;
const encodedToolArgumentsSchema = z.string().transform((value, context) => {
  try {
    return jsonObjectSchema.parse(JSON.parse(value));
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tool arguments must contain a JSON object.",
    });
    return z.NEVER;
  }
});
const toolArgumentsSchema = z.union([
  jsonObjectSchema,
  encodedToolArgumentsSchema,
]);

const tracedAI = wrapAISDK(aiSdk, {
  storeMessages: false,
  storeTools: false,
});

export class AiSdkAgentInference implements AgentInference {
  readonly model = {
    id: OPEN_CODE_GO_MODEL,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    limitSource: "model_catalog",
  } as const;
  private readonly provider;

  constructor(
    apiKey: string,
    private readonly context: HostedAgentTraceContext,
    request?: typeof fetch,
  ) {
    this.provider = createOpenAICompatible({
      name: "opencode",
      baseURL: OPEN_CODE_GO_BASE_URL,
      apiKey,
      ...(request ? { fetch: request } : undefined),
    });
  }

  async complete(input: AgentInferenceRequest) {
    const prompt = aiSdkPrompt(input.messages);
    const result = await tracedAI.generateText({
      model: this.provider.chatModel(OPEN_CODE_GO_MODEL),
      ...prompt,
      tools: toolSet(input.tools),
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      maxRetries: 0,
      timeout: HOSTED_INFERENCE_TIMEOUT_MS,
      runtimeContext: {
        agentId: `${this.context.workspaceId}:${this.context.agentId}`,
        conversationId: this.context.conversationId,
        relayWorkflowId: this.context.workflowId,
        workspaceId: this.context.workspaceId,
        jobId: this.context.jobId,
      },
      telemetry: {
        functionId: this.context.agentId,
        recordInputs: false,
        recordOutputs: false,
        includeRuntimeContext: {
          agentId: true,
          conversationId: true,
          relayWorkflowId: true,
          workspaceId: true,
          jobId: true,
        },
      },
    });
    return {
      content: result.text || null,
      toolCalls: result.toolCalls.map((call) => ({
        id: call.toolCallId,
        name: call.toolName,
        arguments: toolArgumentsSchema.parse(call.input),
      })),
    };
  }

  estimateTokens(input: AgentInferenceRequest) {
    return Math.max(0, Math.round(JSON.stringify(input).length / 4));
  }
}

export function createAiSdkAgentInference(
  apiKey: string | undefined,
  context: HostedAgentTraceContext,
) {
  if (!apiKey?.trim()) {
    throw new Error("OpenCode Go is not configured for hosted agents.");
  }
  return new AiSdkAgentInference(apiKey, context);
}

function aiSdkPrompt(messages: readonly AgentInferenceMessage[]): {
  instructions: Extract<ModelMessage, { role: "system" }>[] | undefined;
  messages: ModelMessage[];
} {
  const instructions: Extract<ModelMessage, { role: "system" }>[] = [];
  const conversation: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      instructions.push({ role: "system", content: message.content ?? "" });
    } else {
      conversation.push(modelMessage({ ...message, role: message.role }));
    }
  }
  return {
    instructions: instructions.length > 0 ? instructions : undefined,
    messages: conversation,
  };
}

function modelMessage(
  message: AgentInferenceMessage & { role: "user" | "assistant" | "tool" },
): ModelMessage {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: [
        ...(message.content
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...message.toolCalls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.arguments,
        })),
      ],
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.toolCallId ?? "missing-tool-call-id",
          toolName: message.name ?? "unknown-tool",
          output: { type: "text", value: message.content ?? "" },
        },
      ],
    };
  }
  return { role: message.role, content: message.content ?? "" };
}

function toolSet(definitions: readonly AgentInferenceTool[]): ToolSet {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      aiSdk.tool({
        description: definition.description,
        inputSchema: aiSdk.jsonSchema(definition.parameters),
      }),
    ]),
  );
}
