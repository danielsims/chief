import type {
  AgentInference,
  AgentInferenceMessage,
  AgentInferenceTool,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

export interface PortableAgentTurn {
  inference: AgentInference;
  messages: AgentInferenceMessage[];
  tools: readonly AgentInferenceTool[];
  execute: (call: AgentInferenceToolCall) => Promise<JsonValue>;
  maxRounds?: number;
  maxTokens?: number;
  temperature?: number;
}

export async function runPortableAgentTurn(input: PortableAgentTurn) {
  const maxRounds = input.maxRounds ?? 24;
  for (let round = 0; round < maxRounds; round += 1) {
    const response = await input.inference.complete({
      messages: input.messages,
      tools: input.tools,
      maxTokens: input.maxTokens ?? 2_000,
      temperature: input.temperature ?? 0.3,
    });
    input.messages.push({
      role: "assistant",
      content: response.content,
      ...(response.toolCalls.length > 0
        ? { toolCalls: response.toolCalls }
        : undefined),
    });
    if (response.toolCalls.length === 0) {
      const text = response.content?.trim();
      if (!text) throw new Error("The agent returned an empty response.");
      return text;
    }
    for (const call of response.toolCalls) {
      const result = await executeTool(input.execute, call);
      input.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(result).slice(0, 20_000),
      });
    }
  }
  throw new Error(`The agent exceeded ${maxRounds} tool rounds.`);
}

async function executeTool(
  execute: PortableAgentTurn["execute"],
  call: AgentInferenceToolCall,
): Promise<JsonValue> {
  try {
    return await execute(call);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tool execution failed.",
    };
  }
}
