import { z } from "zod";

import type {
  AgentInference,
  AgentInferenceMessage,
  AgentInferenceRequest,
} from "@chief/agent-computer";
import { isJsonString } from "@chief/relay-contracts";

const OPEN_CODE_GO_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const OPEN_CODE_GO_MODEL = "deepseek-v4-flash";

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
});

const errorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({ message: z.string() }).transform((error) => error.message),
  ]),
});

export class OpenCodeAgentInference implements AgentInference {
  private readonly request: HttpRequest;

  constructor(
    private readonly apiKey: string,
    request?: HttpRequest,
  ) {
    this.request = request
      ? (input, init) => request(input, init)
      : (input, init) => fetch(input, init);
  }

  async complete(input: AgentInferenceRequest) {
    const response = await this.request(OPEN_CODE_GO_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPEN_CODE_GO_MODEL,
        messages: input.messages.map(openCodeMessage),
        tools: input.tools.map((definition) => ({
          type: "function",
          function: definition,
        })),
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenCode inference failed (${response.status}): ${errorMessage(body)}`,
      );
    }
    const parsed = completionSchema.parse(JSON.parse(body));
    const choice = parsed.choices[0];
    if (!choice) throw new Error("OpenCode returned no completion choices.");
    const message = choice.message;
    return {
      content: message.content,
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    };
  }
}

export function createOpenCodeAgentInference(apiKey: string | undefined) {
  if (!apiKey?.trim()) {
    throw new Error("OpenCode Go is not configured for hosted agents.");
  }
  return new OpenCodeAgentInference(apiKey);
}

type HttpRequest = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function openCodeMessage(message: AgentInferenceMessage) {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: isJsonString(call.arguments)
            ? call.arguments
            : JSON.stringify(call.arguments),
        },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content ?? "",
      tool_call_id: message.toolCallId ?? "",
    };
  }
  return { role: message.role, content: message.content ?? "" };
}

function errorMessage(body: string) {
  try {
    const parsed = errorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch {
    return body.slice(0, 500);
  }
  return body.slice(0, 500);
}
