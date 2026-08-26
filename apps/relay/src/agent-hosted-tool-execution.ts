import type { AgentPrincipal } from "@chief/relay-contracts";

import type { AgentExecutionEnvironment } from "./agent-execution-environment";
import { publishHostedBrowserActivity } from "./agent-hosted-activity";
import { executeHostedAgentTool } from "./hosted-agent-tools";

type AgentJob = Parameters<typeof executeHostedAgentTool>[3];

export async function executeObservedHostedAgentTool<Input>(
  execution: AgentExecutionEnvironment,
  browserEnabled: boolean,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: Input,
) {
  const output = await executeHostedAgentTool(
    execution.computer,
    browserEnabled ? execution.browser : undefined,
    env,
    job,
    principal,
    name,
    rawArguments,
  );
  await publishHostedBrowserActivity(
    env,
    job,
    principal,
    execution.browser,
    name,
    output,
  ).catch((error) => console.error("Hosted browser activity failed", error));
  return output;
}
