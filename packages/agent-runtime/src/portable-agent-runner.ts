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
  /** Optional explicit cap for callers that want one. By default an agent
   * works as long as its turn requires; the loop exits the moment the model
   * returns a tool-call-free answer. */
  maxRounds?: number;
  maxTokens?: number;
  temperature?: number;
}

export async function runPortableAgentTurn(input: PortableAgentTurn) {
  let round = 0;
  for (;;) {
    if (input.maxRounds !== undefined && round >= input.maxRounds) {
      throw new Error(`The agent exceeded ${input.maxRounds} tool rounds.`);
    }
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
    round += 1;
  }
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
