import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import {
  localAgentToolDefinitions,
  parseLocalAgentToolCall,
} from "@chief/agent-runtime/local-tools";

import { hostedAgentTools } from "./hosted-agent-tools/registry";
import { hostedAgentToolName } from "./hosted-agent-tools/tool";
import { recentConversationMessages } from "./hosted-agent-tools/toolkits/channels";

export { recentConversationMessages };

function availableTools(browserEnabled: boolean) {
  return hostedAgentTools.filter(
    (tool) => browserEnabled || !tool.requiresBrowser,
  );
}

export function hostedAgentToolDefinitions(browserEnabled: boolean) {
  return localAgentToolDefinitions(
    availableTools(browserEnabled).map((tool) => tool.definition),
  );
}

export async function executeHostedAgentTool<Input>(
  computer: AgentComputer,
  browser: AgentBrowser | undefined,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: Input,
) {
  const tools = availableTools(browser !== undefined);
  const handler = tools.find((tool) => hostedAgentToolName(tool) === name);
  if (!handler) throw new Error(`Unknown hosted agent tool: ${name}`);
  const parsed = parseLocalAgentToolCall(
    [handler.definition],
    name,
    rawArguments,
  );
  return await handler.execute(
    { computer, browser, env, job, principal },
    parsed.input,
  );
}
