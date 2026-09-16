import { ZodError } from "zod";

import type {
  AgentBrowser,
  AgentComputer,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { DurableTool } from "@chief/agent-runtime/durable-turn";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import {
  localAgentToolDefinitions,
  parseLocalAgentToolCall,
} from "@chief/agent-runtime/local-tools";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import { hostedAgentTools } from "./hosted-agent-tools/registry";
import { hostedAgentToolName } from "./hosted-agent-tools/tool";
import { recentConversationMessages } from "./hosted-agent-tools/toolkits/channels";
import { HttpError } from "./http";

export { recentConversationMessages };

interface HostedToolAvailability {
  browserEnabled: boolean;
  computerEnabled: boolean;
}

function availableTools(availability: HostedToolAvailability) {
  return hostedAgentTools.filter(
    (tool) =>
      (availability.browserEnabled || !tool.requiresBrowser) &&
      (availability.computerEnabled || !tool.requiresComputer),
  );
}

export function hostedAgentToolDefinitions(
  availability: HostedToolAvailability,
) {
  return localAgentToolDefinitions(
    availableTools(availability).map((tool) => tool.definition),
  );
}

export function hostedDurableTools(
  availability: HostedToolAvailability,
): DurableTool[] {
  return availableTools(availability).map((tool) => {
    const definition = localAgentToolDefinitions([tool.definition])[0];
    if (!definition) throw new Error("Hosted tool definition is missing.");
    return { definition, effect: tool.effect };
  });
}

export async function executeHostedAgentTool(
  computer: AgentComputer,
  browser: AgentBrowser | undefined,
  computerEnabled: boolean,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: AgentInferenceToolCall["arguments"],
) {
  const tools = availableTools({
    browserEnabled: browser !== undefined,
    computerEnabled,
  });
  const handler = tools.find((tool) => hostedAgentToolName(tool) === name);
  if (!handler) throw new Error(`Unknown hosted agent tool: ${name}`);
  const parsed = parseHostedAgentToolCall(
    handler.definition,
    name,
    rawArguments,
  );
  try {
    return await handler.execute(
      { computer, browser, env, job, principal },
      parsed.input,
    );
  } catch (error) {
    throw parseRecoverableHostedToolError(error);
  }
}

export function parseRecoverableHostedToolError(error: unknown) {
  if (error instanceof RecoverableToolError) return error;
  if (error instanceof HttpError && error.status < 500) {
    return new RecoverableToolError(error.message);
  }
  if (error instanceof ZodError) {
    return new RecoverableToolError(
      error.issues[0]?.message ?? "Tool input is invalid.",
    );
  }
  return error instanceof Error ? error : new Error("Tool execution failed.");
}

function parseHostedAgentToolCall(
  definition: Parameters<typeof parseLocalAgentToolCall>[0][number],
  name: string,
  rawArguments: AgentInferenceToolCall["arguments"],
) {
  try {
    return parseLocalAgentToolCall(
      [definition],
      name,
      normalizeHostedToolArguments(name, rawArguments),
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Tool input is invalid.";
    throw new RecoverableToolError(
      `${name} was not run because its input was rejected. ${detail}`,
    );
  }
}

export function normalizeHostedToolArguments(
  name: string,
  rawArguments: AgentInferenceToolCall["arguments"],
) {
  if (name !== "channels_messages_post") return rawArguments;
  const input = parseJsonObject(rawArguments);
  if (!input || !isJsonString(input.mentions)) return rawArguments;
  return { ...input, mentions: [input.mentions] };
}
