import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapAISDK } from "agents/observability/ai";
import * as aiSdk from "ai";
import { z } from "zod";

import type {
  AgentInference,
  AgentInferenceMessage,
  AgentInferenceProgressObserver,
  AgentInferenceRequest,
  AgentInferenceTool,
} from "@chief/agent-computer";
import type { AgentInferenceConfig } from "@chief/relay-contracts";
import { jsonObjectSchema } from "@chief/relay-contracts";

import type { HostedAgentTraceContext } from "./agent-tracing";

const OPEN_CODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
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
  readonly model;
  private readonly languageModel: LanguageModel;

  constructor(
    apiKey: string,
    private readonly context: HostedAgentTraceContext,
    request?: typeof fetch,
    inference: AgentInferenceConfig = {
      provider: "opencode",
      model: "opencode-go/deepseek-v4-flash",
      secretRef: "opencode",
    },
  ) {
    this.model = {
      id: inference.model,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      limitSource: "model_catalog" as const,
    };
    this.languageModel = languageModel(inference, apiKey, request);
  }

  async complete(
    input: AgentInferenceRequest,
    onProgress?: AgentInferenceProgressObserver,
  ) {
    const prompt = aiSdkPrompt(input.messages);
    const options = {
      model: this.languageModel,
      ...prompt,
      tools: toolSet(input.tools),
      ...(input.maxTokens === undefined
        ? undefined
        : { maxOutputTokens: input.maxTokens }),
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
    };
    if (onProgress) return await this.completeStreaming(options, onProgress);
    const result = await tracedAI.generateText(options);
    return {
      content: result.text || null,
      ...(result.reasoningText
        ? { reasoning: result.reasoningText }
        : undefined),
      toolCalls: result.toolCalls.map((call) => ({
        id: call.toolCallId,
        name: call.toolName,
        arguments: toolArgumentsSchema.parse(call.input),
      })),
    };
  }

  private async completeStreaming(
    options: Parameters<typeof tracedAI.streamText>[0],
    onProgress: AgentInferenceProgressObserver,
  ) {
    const result = tracedAI.streamText(options);
    let reasoning = "";
    for await (const part of result.stream) {
      if (part.type !== "reasoning-delta" || !part.text) continue;
      reasoning += part.text;
      await onProgress({
        type: "reasoning",
        delta: part.text,
        text: reasoning,
      });
    }
    const [content, reasoningText, toolCalls] = await Promise.all([
      result.text,
      result.reasoningText,
      result.toolCalls,
    ]);
    return {
      content: content || null,
      ...(reasoningText ? { reasoning: reasoningText } : undefined),
      toolCalls: toolCalls.map((call) => ({
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
  inference: AgentInferenceConfig,
  context: HostedAgentTraceContext,
) {
  if (!apiKey?.trim()) {
    throw new Error(
      `${inferenceProviderName(inference)} is not configured for hosted agents.`,
    );
  }
  return new AiSdkAgentInference(apiKey, context, undefined, inference);
}

function languageModel(
  inference: AgentInferenceConfig,
  apiKey: string,
  request?: typeof fetch,
): LanguageModel {
  switch (inference.provider) {
    case "opencode":
      return createOpenAICompatible({
        name: "opencode",
        baseURL: OPEN_CODE_GO_BASE_URL,
        apiKey,
        ...(request ? { fetch: request } : undefined),
      }).chatModel(openCodeGoModel(inference.model));
    case "vercel-ai-gateway":
      return createGateway({
        apiKey,
        ...(request ? { fetch: request } : undefined),
      })(inference.model);
    case "claude":
    case "codex":
      throw new Error(
        `${inferenceProviderName(inference)} can only run on a connected device.`,
      );
  }
}

function openCodeGoModel(model: string) {
  return model.startsWith("opencode-go/")
    ? model.slice("opencode-go/".length)
    : model;
}

function inferenceProviderName(inference: AgentInferenceConfig) {
  switch (inference.provider) {
    case "opencode":
      return "OpenCode Go";
    case "vercel-ai-gateway":
      return "Vercel AI Gateway";
    case "claude":
      return "Claude";
    case "codex":
      return "ChatGPT";
  }
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
        ...(message.reasoning
          ? [{ type: "reasoning" as const, text: message.reasoning }]
          : []),
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
