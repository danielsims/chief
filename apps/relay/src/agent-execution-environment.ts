import type { Workspace } from "@cloudflare/computer";

import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { AgentJob } from "@chief/relay-contracts";

import { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { WorkspaceMachineBrowser } from "./workspace-machine-browser";

export interface AgentExecutionEnvironment {
  browser: AgentBrowser;
  computer: AgentComputer;
}
export type AgentExecutionEnvironmentFactory = (
  job: AgentJob,
) => AgentExecutionEnvironment;

/** Public browsing requires an enrolled, owner-authorized browser machine.
 * A global executor CDP endpoint cannot provide workspace/session isolation. */
export function createAgentExecutionEnvironmentFactory(
  env: Env,
  workspace: Workspace,
): AgentExecutionEnvironmentFactory {
  const computer = new CloudflareAgentComputer(workspace);
  return (job) => ({
    browser: new WorkspaceMachineBrowser(env, job),
    computer,
  });
}
