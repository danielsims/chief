import { z } from "zod";

import type {
  AgentInference,
  AgentInferenceMessage,
  AgentInferenceRequest,
} from "@chief/agent-computer";

const nativeInferenceSchema = z.object({
  response: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        name: z.string(),
        arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
      }),
    )
    .optional(),
});

export class CloudflareAgentInference implements AgentInference {
  constructor(
    private readonly binding: Ai,
    private readonly model: string,
  ) {}

  async complete(input: AgentInferenceRequest) {
    const output: unknown = await this.binding.run(this.model, {
      messages: input.messages.map(nativeMessage),
      ...(input.tools.length > 0 ? { tools: [...input.tools] } : undefined),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    });
    return parseCloudflareInferenceOutput(output);
  }
}

export function parseCloudflareInferenceOutput(output: unknown) {
  const parsed = nativeInferenceSchema.parse(output);
  return {
    content: parsed.response ?? null,
    toolCalls: (parsed.tool_calls ?? []).map((call) => ({
      id: crypto.randomUUID(),
      name: call.name,
      arguments: call.arguments,
    })),
  };
}

function nativeMessage(message: AgentInferenceMessage) {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant" as const,
      content: JSON.stringify(
        message.toolCalls.map((call) => ({
          name: call.name,
          arguments: call.arguments,
        })),
      ),
    };
  }
  return { role: message.role, content: message.content ?? "" };
}
