import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { DurableTool } from "@chief/agent-runtime/durable-turn";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import {
  localAgentToolDefinitions,
  parseLocalAgentToolCall,
} from "@chief/agent-runtime/local-tools";

import { hostedAgentTools } from "./hosted-agent-tools/registry";
import { hostedAgentToolName } from "./hosted-agent-tools/tool";
import { recentConversationMessages } from "./hosted-agent-tools/toolkits/channels";

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

export async function executeHostedAgentTool<Input>(
  computer: AgentComputer,
  browser: AgentBrowser | undefined,
  computerEnabled: boolean,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: Input,
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
  return await handler.execute(
    { computer, browser, env, job, principal },
    parsed.input,
  );
}

function parseHostedAgentToolCall(
  definition: Parameters<typeof parseLocalAgentToolCall>[0][number],
  name: string,
  rawArguments: unknown,
) {
  try {
    return parseLocalAgentToolCall([definition], name, rawArguments);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Tool input is invalid.";
    throw new RecoverableToolError(
      `${name} was not run because its input was rejected. ${detail}`,
    );
  }
}
