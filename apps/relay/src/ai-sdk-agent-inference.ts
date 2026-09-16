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
import {
  isJsonString,
  jsonObjectSchema,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { HostedAgentTraceContext } from "./agent-tracing";

const OPEN_CODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
// OpenCode Go requires a coding-agent User-Agent and a stable session header.
const OPEN_CODE_USER_AGENT = "Chief/1.0 (+https://heychief.sh)";
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
    this.languageModel = languageModel(inference, apiKey, request, context);
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
    return await this.completeGenerated(options);
  }

  private async completeGenerated(
    options: Parameters<typeof tracedAI.generateText>[0],
  ) {
    const result = await tracedAI.generateText(options);
    return completionFromResult(result);
  }

  private async completeStreaming(
    options: Parameters<typeof tracedAI.streamText>[0],
    onProgress: AgentInferenceProgressObserver,
  ) {
    let streamError: Error | undefined;
    const result = tracedAI.streamText({
      ...options,
      onError: ({ error }) => {
        streamError = parseHostedStreamError(error);
      },
    });
    let reasoning = "";
    try {
      for await (const part of result.stream) {
        if (part.type !== "reasoning-delta" || !part.text) continue;
        reasoning += part.text;
        await onProgress({
          type: "reasoning",
          delta: part.text,
          text: reasoning,
        });
      }
    } catch (error) {
      streamError ??= parseHostedStreamError(error);
    }
    let text = "";
    let reasoningText: string | undefined;
    let toolCalls: Awaited<typeof result.toolCalls> = [];
    try {
      [text, reasoningText, toolCalls] = await Promise.all([
        result.text,
        result.reasoningText,
        result.toolCalls,
      ]);
    } catch (error) {
      streamError ??= parseHostedStreamError(error);
    }
    let fromResult = "";
    try {
      fromResult = await reasoningFromResult(result);
    } catch (error) {
      streamError ??= parseHostedStreamError(error);
    }
    const completion = completionFromResult({
      text,
      reasoningText:
        [reasoningText, reasoning, fromResult].find((value) => value?.trim()) ??
        undefined,
      toolCalls,
    });
    if (
      streamError &&
      !completion.content &&
      !completion.reasoning &&
      completion.toolCalls.length === 0
    ) {
      throw streamError;
    }
    return completion;
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
  request: typeof fetch | undefined,
  context: HostedAgentTraceContext,
): LanguageModel {
  switch (inference.provider) {
    case "opencode":
      return createOpenAICompatible({
        name: "opencode",
        baseURL: OPEN_CODE_GO_BASE_URL,
        apiKey,
        headers: openCodeRequestHeaders(context),
        fetch: (input, init) => fetchOpenCode(request, context, input, init),
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

function completionFromResult(result: {
  text: string;
  reasoningText?: string;
  toolCalls: readonly {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }[];
}) {
  return {
    content: result.text || null,
    ...(result.reasoningText ? { reasoning: result.reasoningText } : undefined),
    toolCalls: result.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: toolArgumentsSchema.parse(call.input),
    })),
  };
}

async function reasoningFromResult(result: {
  reasoning: PromiseLike<readonly unknown[]>;
}) {
  const parts = await result.reasoning;
  return parts
    .flatMap((part) => {
      const text = parseJsonObject(part)?.text;
      return isJsonString(text) && text ? [text] : [];
    })
    .join("");
}

const hostedStreamErrorMessageSchema = z.object({
  message: z.string().trim().min(1),
});

function parseHostedStreamError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error;
  const parsed = hostedStreamErrorMessageSchema.safeParse(error);
  if (parsed.success) return new Error(parsed.data.message);
  return new Error("The inference stream ended without a usable response.");
}

function openCodeGoModel(model: string) {
  return model.startsWith("opencode-go/")
    ? model.slice("opencode-go/".length)
    : model;
}

function openCodeSessionId(context: HostedAgentTraceContext) {
  return `${context.workspaceId}:${context.agentId}:${context.conversationId}`;
}

function openCodeRequestHeaders(context: HostedAgentTraceContext) {
  return {
    "User-Agent": OPEN_CODE_USER_AGENT,
    "x-opencode-session": openCodeSessionId(context),
  };
}

async function fetchOpenCode(
  request: typeof fetch | undefined,
  context: HostedAgentTraceContext,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const fetchImpl = request ?? globalThis.fetch;
  const headers = openCodeFetchHeaders(input, init, context);
  const response = await fetchImpl(input, { ...init, headers });
  if (response.ok) return rewriteOpenCodeStream(response);
  const payload = openCodeErrorPayload(response.status, await response.text());
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText || "Error",
    headers: { "content-type": "application/json" },
  });
}

function rewriteOpenCodeStream(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    return response;
  }
  return new Response(response.body.pipeThrough(openCodeSseTransform()), {
    status: response.status,
    statusText: response.statusText || "OK",
    headers: response.headers,
  });
}

function openCodeSseTransform() {
  let buffer = "";
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = emitOpenCodeSse(buffer, encoder, controller, false);
    },
    flush(controller) {
      emitOpenCodeSse(buffer + decoder.decode(), encoder, controller, true);
    },
  });
}

function emitOpenCodeSse(
  buffer: string,
  encoder: TextEncoder,
  controller: TransformStreamDefaultController<Uint8Array>,
  includeTail: boolean,
) {
  const events = buffer.split(/\r?\n\r?\n/);
  const pending = includeTail ? "" : (events.pop() ?? "");
  for (const event of events) {
    const rewritten = rewriteOpenCodeSseEvent(event);
    if (rewritten !== undefined)
      controller.enqueue(encoder.encode(`${rewritten}\n\n`));
  }
  return pending;
}

function rewriteOpenCodeSseEvent(event: string) {
  const trimmed = event.trim();
  if (!trimmed) return undefined;
  const lines = event.split(/\r?\n/);
  const eventName = lines
    .find((line) => line.toLowerCase().startsWith("event:"))
    ?.replace(/^event:\s*/i, "")
    .trim();
  if (eventName === "ping" || trimmed === ": ping") return undefined;
  const data = lines
    .filter((line) => line.toLowerCase().startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/i, ""))
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return event;
  const parsed = parseOpenCodeJson(data);
  if (!isOpenCodeStreamError(parsed)) return event;
  const message = openCodeErrorMessage(data);
  return `data: ${JSON.stringify(openCodeErrorPayload(200, message ?? ""))}`;
}

function parseOpenCodeJson(value: string) {
  if (!value.startsWith("{") && !value.startsWith("[")) return undefined;
  try {
    return parseJsonValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function isOpenCodeStreamError(value: unknown) {
  const document = parseJsonObject(value);
  if (!document || !("error" in document) || "choices" in document) {
    return false;
  }
  const error = document.error;
  if (isJsonString(error)) return !error.trim();
  const payload = parseJsonObject(error);
  if (!payload) return true;
  return !isJsonString(payload.message) || !payload.message.trim();
}

function openCodeFetchHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: HostedAgentTraceContext,
) {
  const headers = new Headers(init?.headers);
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      if (!headers.has(key)) headers.set(key, value);
    });
  }
  headers.set("user-agent", OPEN_CODE_USER_AGENT);
  headers.set("x-opencode-session", openCodeSessionId(context));
  return headers;
}

function openCodeErrorPayload(status: number, body: string) {
  const trimmed = body.trim();
  return {
    error: {
      message:
        openCodeErrorMessage(trimmed) ??
        (trimmed
          ? trimmed.slice(0, 500)
          : `OpenCode Go returned HTTP ${status} with an empty body.`),
      type: "api_error",
      code: status,
    },
  };
}

function openCodeErrorMessage(body: string) {
  if (!body.startsWith("{")) return undefined;
  const record = parseJsonObject(parseOpenCodeJson(body));
  if (!record) return undefined;
  if (isJsonString(record.error) && record.error.trim()) {
    return record.error.trim();
  }
  const nested = parseJsonObject(record.error);
  if (isJsonString(nested?.message) && nested.message.trim()) {
    return nested.message.trim();
  }
  if (isJsonString(record.message) && record.message.trim()) {
    return record.message.trim();
  }
  return undefined;
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
  if (message.role === "assistant") {
    const content = [
      ...(message.reasoning
        ? [{ type: "reasoning" as const, text: message.reasoning }]
        : []),
      ...(message.content
        ? [{ type: "text" as const, text: message.content }]
        : []),
      ...(message.toolCalls?.map((call) => ({
        type: "tool-call" as const,
        toolCallId: call.id,
        toolName: call.name,
        input: call.arguments,
      })) ?? []),
    ];
    return content.length > 0
      ? { role: "assistant", content }
      : { role: "assistant", content: message.content ?? "" };
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
  return { role: "user", content: message.content ?? "" };
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
